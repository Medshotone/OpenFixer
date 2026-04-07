import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { TextPart } from "@opencode-ai/sdk/v2"

// Connect to already-running opencode server (default port 4096, override with OPENCODE_SERVER_URL)
const base = process.env.OPENCODE_SERVER_URL ?? "http://127.0.0.1:4096"

// Use CLI args if provided, otherwise discover from DB
const argDirs = process.argv.slice(2)
const dirs = argDirs.length
  ? argDirs
  : await createOpencodeClient({ baseUrl: base })
      .global.jira.dirs()
      .then((r) => r.data ?? [])
      .catch(() => [] as string[])

if (!dirs.length) {
  console.log("No Jira-enabled projects found. Configure Jira settings in the UI first.")
  process.exit(0)
}

const processed = new Set<string>()
const checked = new Map<string, string>()
const clients = new Map<string, ReturnType<typeof createOpencodeClient>>()

function client(dir: string) {
  if (!clients.has(dir)) clients.set(dir, createOpencodeClient({ baseUrl: base, directory: dir }))
  return clients.get(dir)!
}

type IssueFields = {
  summary: string
  description: unknown
  status: { name: string } | null
  assignee: { displayName: string } | null
}

async function poll(dir: string) {
  const cfg = await client(dir).jira.get({ directory: dir })
  if (cfg.error || !cfg.data || !cfg.data.enabled) return

  const token = (await client(dir).jira.token({ directory: dir })).data
  if (!token) return

  const auth = btoa(`${cfg.data.email}:${token}`)
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" }
  const since = checked.get(dir) ?? new Date(Date.now() - cfg.data.interval * 2 * 1000).toISOString().replace("T", " ").slice(0, 16)
  const jql = encodeURIComponent(`project=${cfg.data.project_key} AND comment ~ "@OpenFixer" AND updated >= "${since}"`)

  const res = await fetch(`${cfg.data.url}/rest/api/3/search?jql=${jql}&fields=summary,description,status,assignee`, { headers }).catch(() => null)
  if (!res?.ok) return

  // update only after successful fetch to avoid missing issues on transient failures
  checked.set(dir, new Date().toISOString().replace("T", " ").slice(0, 16))

  const { issues } = (await res.json()) as { issues: { key: string; fields: IssueFields }[] }

  for (const issue of issues) {
    const cres = await fetch(`${cfg.data.url}/rest/api/3/issue/${issue.key}/comment?orderBy=-created&maxResults=50`, { headers }).catch(() => null)
    if (!cres?.ok) continue
    const { comments } = (await cres.json()) as { comments: { id: string; body: unknown }[] }

    for (const comment of comments) {
      const key = `${issue.key}:${comment.id}`
      if (processed.has(key)) continue

      const text = extract(comment.body)
      if (!text.toLowerCase().includes("@openfixer")) continue

      processed.add(key)
      console.log(`[jira] Processing @OpenFixer in ${issue.key} comment ${comment.id}`)

      const session = await client(dir).session.create({ title: `Jira: ${issue.key} - ${issue.fields.summary}`, directory: dir })
      if (session.error) continue

      const result = await client(dir).session.prompt({
        sessionID: session.data.id,
        directory: dir,
        parts: [{ type: "text", text: context(issue, text) }],
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

function extract(node: unknown): string {
  if (!node || typeof node !== "object") return ""
  const n = node as { text?: string; content?: unknown[] }
  if (n.text) return n.text
  return (n.content ?? []).map(extract).join(" ")
}

function context(issue: { key: string; fields: IssueFields }, comment: string): string {
  return `You are reviewing a Jira issue. Here is the full context:

**Issue**: ${issue.key} - ${issue.fields.summary}
**Status**: ${issue.fields.status?.name ?? "Unknown"}
**Assignee**: ${issue.fields.assignee?.displayName ?? "Unassigned"}

**Description**:
${extract(issue.fields.description) || "(no description)"}

**Request from @OpenFixer mention**:
${comment.replace(/@openfixer/gi, "").trim()}`
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
