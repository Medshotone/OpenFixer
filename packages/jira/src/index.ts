import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { TextPart } from "@opencode-ai/sdk/v2"

const dirs = process.argv.slice(2)

if (!dirs.length) {
  console.error("Usage: bun run src/index.ts <project-dir> [project-dir2 ...]")
  process.exit(1)
}

console.log("Starting opencode server...")
const { server } = await createOpencode({ port: 0 })
console.log("Opencode server ready at", server.url)

const processed = new Set<string>()

function client(dir: string) {
  return createOpencodeClient({ baseUrl: server.url, directory: dir })
}

async function poll(dir: string) {
  const cfg = await client(dir).jira.get({ directory: dir })
  if (cfg.error || !cfg.data || !cfg.data.enabled) return

  // token is stripped from GET response for security; use env var
  const token = process.env.JIRA_TOKEN
  if (!token) return

  const auth = btoa(`${cfg.data.email}:${token}`)
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" }
  const since = new Date(Date.now() - cfg.data.interval * 2000).toISOString().replace("T", " ").slice(0, 16)
  const jql = encodeURIComponent(`project=${cfg.data.project_key} AND comment ~ "@opencode" AND updated >= "${since}"`)

  const res = await fetch(`${cfg.data.url}/rest/api/3/search?jql=${jql}&fields=summary,description,status,assignee`, { headers }).catch(() => null)
  if (!res?.ok) return

  const { issues } = (await res.json()) as { issues: { key: string; fields: { summary: string; description: unknown; status: { name: string } | null; assignee: { displayName: string } | null } }[] }

  for (const issue of issues) {
    const commRes = await fetch(`${cfg.data.url}/rest/api/3/issue/${issue.key}/comment?orderBy=-created&maxResults=50`, { headers }).catch(() => null)
    if (!commRes?.ok) continue
    const { comments } = (await commRes.json()) as { comments: { id: string; body: unknown }[] }

    for (const comment of comments) {
      const key = `${issue.key}:${comment.id}`
      if (processed.has(key)) continue

      const text = extractText(comment.body)
      if (!text.includes("@opencode")) continue

      processed.add(key)
      console.log(`[jira] Processing @opencode in ${issue.key} comment ${comment.id}`)

      const c = client(dir)
      const session = await c.session.create({ title: `Jira: ${issue.key} - ${issue.fields.summary}`, directory: dir })
      if (session.error) continue

      const result = await c.session.prompt({
        sessionID: session.data.id,
        directory: dir,
        parts: [{ type: "text", text: buildPrompt(issue, text) }],
      })
      if (result.error) continue

      const reply = result.data.parts
        .filter((p): p is TextPart => p.type === "text")
        .map((p) => p.text)
        .join("\n")
      if (!reply) continue

      await fetch(`${cfg.data.url}/rest/api/3/issue/${issue.key}/comment`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: reply }] }] },
        }),
      })
      console.log(`[jira] Replied to ${issue.key} comment ${comment.id}`)
    }
  }
}

function extractText(body: unknown): string {
  if (!body || typeof body !== "object") return ""
  const b = body as { content?: { content?: { text?: string }[] }[] }
  return (b.content ?? [])
    .flatMap((block) => block.content ?? [])
    .map((node) => node.text ?? "")
    .join(" ")
}

function buildPrompt(issue: { key: string; fields: { summary: string; description: unknown; status: { name: string } | null; assignee: { displayName: string } | null } }, comment: string): string {
  return `You are reviewing a Jira issue. Here is the full context:

**Issue**: ${issue.key} - ${issue.fields.summary}
**Status**: ${issue.fields.status?.name ?? "Unknown"}
**Assignee**: ${issue.fields.assignee?.displayName ?? "Unassigned"}

**Description**:
${extractText(issue.fields.description) || "(no description)"}

**Request from @opencode mention**:
${comment.replace(/@opencode/gi, "").trim()}`
}

for (const dir of dirs) {
  const cfg = await client(dir).jira.get({ directory: dir }).catch(() => null)
  if (!cfg?.data?.enabled) {
    console.log(`[jira] Skipping ${dir} — Jira not enabled`)
    continue
  }
  const interval = cfg.data.interval * 1000
  console.log(`[jira] Polling ${dir} (project: ${cfg.data.project_key}) every ${cfg.data.interval}s`)
  poll(dir)
  setInterval(() => poll(dir), interval)
}

console.log("Jira poller running. Ctrl+C to stop.")
