import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { TextPart } from "@opencode-ai/sdk/v2"

// Connect to already-running opencode server (default port 4096, override with OPENCODE_SERVER_URL)
const base = process.env.OPENCODE_SERVER_URL ?? "http://127.0.0.1:4096"

console.log(`[jira] Connecting to opencode server at ${base}`)

// Use CLI args if provided, otherwise discover from DB
const argDirs = process.argv.slice(2)
const dirs = argDirs.length
  ? argDirs
  : await createOpencodeClient({ baseUrl: base })
      .global.jira.dirs()
      .then((r) => {
        console.log(`[jira] Discovered ${r.data?.length ?? 0} Jira-enabled project(s)`)
        return r.data ?? []
      })
      .catch((err) => {
        console.error(`[jira] Failed to connect to server: ${err?.message ?? err}`)
        return [] as string[]
      })

if (!dirs.length) {
  console.log("[jira] No Jira-enabled projects found. Configure Jira settings in the UI first.")
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
  if (cfg.error) {
    console.error(`[jira] ${dir}: failed to fetch config — ${cfg.error}`)
    return
  }
  if (!cfg.data) {
    console.log(`[jira] ${dir}: no config found, skipping`)
    return
  }
  if (!cfg.data.enabled) {
    console.log(`[jira] ${dir}: integration disabled, skipping`)
    return
  }

  const token = (await client(dir).jira.token({ directory: dir })).data
  if (!token) {
    console.error(`[jira] ${dir}: no token stored — save settings in the UI first`)
    return
  }

  const auth = btoa(`${cfg.data.email}:${token}`)
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" }
  const since = checked.get(dir) ?? new Date(Date.now() - cfg.data.interval * 2 * 1000).toISOString().replace("T", " ").slice(0, 16)
  const jql = `project=${cfg.data.project_key} AND comment ~ "@OpenFixer" AND updated >= "${since}"`

  console.log(`[jira] ${cfg.data.project_key}: polling since ${since}`)

  const res = await fetch(`${cfg.data.url}/rest/api/3/search/jql`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ jql, fields: ["summary", "description", "status", "assignee"] }),
  }).catch(() => null)
  if (!res) {
    console.error(`[jira] ${cfg.data.project_key}: network error reaching Jira`)
    return
  }
  if (!res.ok) {
    console.error(`[jira] ${cfg.data.project_key}: Jira API error ${res.status} ${res.statusText}`)
    return
  }

  // update only after successful fetch to avoid missing issues on transient failures
  checked.set(dir, new Date().toISOString().replace("T", " ").slice(0, 16))

  const { issues } = (await res.json()) as { issues: { key: string; fields: IssueFields }[] }
  console.log(`[jira] ${cfg.data.project_key}: found ${issues.length} updated issue(s)`)

  for (const issue of issues) {
    console.log(`[jira] ${issue.key}: checking comments...`)
    const cres = await fetch(`${cfg.data.url}/rest/api/3/issue/${issue.key}/comment?orderBy=-created&maxResults=50`, { headers }).catch(() => null)
    if (!cres?.ok) {
      console.error(`[jira] ${issue.key}: failed to fetch comments (${cres?.status ?? "network error"})`)
      continue
    }
    const { comments } = (await cres.json()) as { comments: { id: string; body: unknown; author: { accountId: string; displayName: string } }[] }
    console.log(`[jira] ${issue.key}: ${comments.length} comment(s) to scan`)

    for (const comment of comments) {
      const key = `${issue.key}:${comment.id}`
      if (processed.has(key)) continue

      const text = extract(comment.body)
      if (!text.toLowerCase().includes("@openfixer")) continue

      console.log(`[jira] ${issue.key} #${comment.id}: @OpenFixer mention found — creating session`)
      processed.add(key)

      const session = await client(dir).session.create({ title: `Jira: ${issue.key} - ${issue.fields.summary}`, directory: dir })
      if (session.error) {
        console.error(`[jira] ${issue.key}: failed to create session — ${session.error}`)
        continue
      }
      console.log(`[jira] ${issue.key}: session created (${session.data.id}), sending prompt...`)

      const result = await client(dir).session.prompt({
        sessionID: session.data.id,
        directory: dir,
        parts: [{ type: "text", text: context(issue, text) }],
      })
      if (result.error) {
        console.error(`[jira] ${issue.key}: prompt failed — ${result.error}`)
        continue
      }

      const reply = result.data.parts
        .filter((p): p is TextPart => p.type === "text")
        .map((p) => p.text)
        .join("\n")
      if (!reply) {
        console.warn(`[jira] ${issue.key}: AI returned empty response, skipping comment post`)
        continue
      }

      console.log(`[jira] ${issue.key}: posting reply to Jira (${reply.length} chars)...`)
      const posted = await fetch(`${cfg.data.url}/rest/api/3/issue/${issue.key}/comment`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          body: {
            type: "doc", version: 1, content: [{
              type: "paragraph", content: [
                { type: "mention", attrs: { id: comment.author.accountId, text: `@${comment.author.displayName}` } },
                { type: "text", text: " " },
                { type: "text", text: reply },
              ],
            }],
          },
        }),
      }).catch(() => null)
      if (posted?.ok) console.log(`[jira] ${issue.key} #${comment.id}: replied successfully`)
      else console.error(`[jira] ${issue.key}: failed to post reply (${posted?.status ?? "network error"})`)
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
  console.log(`[jira] Starting poller for ${dir} (project: ${cfg.data.project_key}, interval: ${cfg.data.interval}s)`)
  poll(dir)
  setInterval(() => poll(dir), cfg.data.interval * 1000)
}

console.log("[jira] Poller running. Ctrl+C to stop.")
