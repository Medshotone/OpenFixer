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

const start = new Date().toISOString()
const processed = new Set<string>()
const clients = new Map<string, ReturnType<typeof createOpencodeClient>>()
const zones = new Map<string, string>()
const lastPoll = new Map<string, Date>()

function jiraTime(date: Date, zone: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(date)
}

function client(dir: string) {
  if (!clients.has(dir)) clients.set(dir, createOpencodeClient({ baseUrl: base, directory: dir }))
  return clients.get(dir)!
}

async function run(cwd: string, cmd: string[]) {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  return { ok: (await p.exited) === 0, out: (out || err).trim() }
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
  const zone = zones.get(dir) ?? "UTC"
  const since = jiraTime(lastPoll.get(dir) ?? new Date(start), zone)
  lastPoll.set(dir, new Date())
  const jql = `project=${cfg.data.project_key} AND comment ~ "@OpenFixer" AND updated >= "${since}" ORDER BY updated DESC`

  console.log(`[jira] ${cfg.data.project_key}: polling since ${since} (${zone})`)

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

  const { issues } = (await res.json()) as { issues: { key: string; fields: IssueFields }[] }
  console.log(`[jira] ${cfg.data.project_key}: found ${issues.length} updated issue(s)`)

  for (const issue of issues) {
    console.log(`[jira] ${issue.key}: checking comments...`)
    const cres = await fetch(`${cfg.data.url}/rest/api/3/issue/${issue.key}/comment?orderBy=-created&maxResults=50`, { headers }).catch(() => null)
    if (!cres?.ok) {
      console.error(`[jira] ${issue.key}: failed to fetch comments (${cres?.status ?? "network error"})`)
      continue
    }
    const { comments } = (await cres.json()) as { comments: { id: string; created: string; body: unknown; author: { accountId: string; displayName: string } }[] }
    console.log(`[jira] ${issue.key}: ${comments.length} comment(s) to scan`)

    for (const comment of comments) {
      if (comment.created < start) continue
      const key = `${issue.key}:${comment.id}`
      if (processed.has(key)) continue

      const text = extract(comment.body)
      if (!text.toLowerCase().includes("@openfixer")) continue

      console.log(`[jira] ${issue.key} #${comment.id}: @OpenFixer mention found — creating workspace`)
      processed.add(key)

      const space = await client(dir).experimental.workspace.create({
        directory: dir, type: "worktree", branch: null, extra: { name: issue.key.toLowerCase() },
      })
      if (space.error || !space.data?.directory || !space.data?.branch) {
        console.error(`[jira] ${issue.key}: failed to create workspace — ${space.error ?? "no directory"}`)
        continue
      }
      console.log(`[jira] ${issue.key}: workspace created (branch: ${space.data.branch})`)

      const session = await client(dir).session.create({
        title: `Jira: ${issue.key} - ${issue.fields.summary}`,
        directory: dir,
        workspaceID: space.data.id,
      })
      if (session.error) {
        console.error(`[jira] ${issue.key}: failed to create session — ${session.error}`)
        await client(dir).experimental.workspace.remove({ id: space.data.id, directory: dir })
        continue
      }
      console.log(`[jira] ${issue.key}: session created (${session.data.id}), sending prompt...`)

      const result = await client(dir).session.prompt({
        sessionID: session.data.id,
        directory: dir,
        parts: [{ type: "text", text: context(issue, text, cfg.data.url, comment.id) }],
      })
      if (result.error) {
        console.error(`[jira] ${issue.key}: prompt failed — ${result.error}`)
        await client(dir).experimental.workspace.remove({ id: space.data.id, directory: dir })
        continue
      }

      const reply = result.data.parts
        .filter((p): p is TextPart => p.type === "text")
        .map((p) => p.text)
        .join("\n")

      const diff = await client(dir).vcs.diff({ directory: dir, workspace: space.data.id, mode: "git" })
      const changed = (diff.data?.length ?? 0) > 0

      let prUrl: string | null = null
      if (!changed) {
        console.log(`[jira] ${issue.key}: no file changes, removing workspace`)
        await client(dir).experimental.workspace.remove({ id: space.data.id, directory: dir })
      } else {
        console.log(`[jira] ${issue.key}: ${diff.data!.length} file(s) changed — committing and opening PR`)
        const msg = `fix(${issue.key}): ${issue.fields.summary}`
        const body = `Resolves: ${cfg.data.url}/browse/${issue.key}\n\nTriggered by @OpenFixer mention in Jira.`
        await run(space.data.directory, ["git", "add", "-A"])
        const committed = await run(space.data.directory, ["git", "commit", "-m", msg])
        if (!committed.ok) {
          console.error(`[jira] ${issue.key}: commit failed — ${committed.out}`)
        } else {
          const pushed = await run(space.data.directory, ["git", "push", "origin", space.data.branch])
          if (!pushed.ok) {
            console.error(`[jira] ${issue.key}: push failed — ${pushed.out}`)
          } else {
            const pr = await run(space.data.directory, ["gh", "pr", "create",
              "--base", "main", "--head", space.data.branch,
              "--title", msg, "--body", body,
            ])
            if (pr.ok) {
              prUrl = pr.out
              console.log(`[jira] ${issue.key}: PR created — ${prUrl}`)
            } else {
              console.error(`[jira] ${issue.key}: PR creation failed — ${pr.out}`)
            }
          }
        }
      }

      const full = prUrl ? `${reply}\n\n**PR**: ${prUrl}` : reply
      if (!full) {
        console.warn(`[jira] ${issue.key}: no reply to post, skipping`)
        continue
      }

      console.log(`[jira] ${issue.key}: posting reply to Jira...`)
      const posted = await fetch(`${cfg.data.url}/rest/api/3/issue/${issue.key}/comment`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          body: {
            type: "doc", version: 1, content: [
              { type: "paragraph", content: [{ type: "mention", attrs: { id: comment.author.accountId, text: `@${comment.author.displayName}` } }] },
              ...mdToAdf(full),
            ],
          },
        }),
      }).catch(() => null)
      if (posted?.ok) console.log(`[jira] ${issue.key} #${comment.id}: replied successfully`)
      else console.error(`[jira] ${issue.key}: failed to post reply (${posted?.status ?? "network error"})`)
    }
  }
}

type AdfMark = { type: string; attrs?: Record<string, unknown> }
type AdfNode = { type: string; attrs?: Record<string, unknown>; content?: AdfNode[]; text?: string; marks?: AdfMark[] }

function inline(src: string): AdfNode[] {
  const nodes: AdfNode[] = []
  const re = /\*\*(.+?)\*\*|__(.+?)__|`(.+?)`|\*(.+?)\*|_(.+?)_/g
  let pos = 0
  for (const m of src.matchAll(re)) {
    if (m.index! > pos) nodes.push({ type: "text", text: src.slice(pos, m.index) })
    if (m[1] ?? m[2]) nodes.push({ type: "text", text: (m[1] ?? m[2])!, marks: [{ type: "strong" }] })
    else if (m[3]) nodes.push({ type: "text", text: m[3], marks: [{ type: "code" }] })
    else nodes.push({ type: "text", text: (m[4] ?? m[5])!, marks: [{ type: "em" }] })
    pos = m.index! + m[0].length
  }
  if (pos < src.length) nodes.push({ type: "text", text: src.slice(pos) })
  return nodes
}

function mdToAdf(md: string): AdfNode[] {
  const blocks: AdfNode[] = []
  const lines = md.split("\n")
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim() || undefined
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++])
      i++
      blocks.push({ type: "codeBlock", attrs: lang ? { language: lang } : {}, content: [{ type: "text", text: code.join("\n") }] })
      continue
    }

    const hm = line.match(/^(#{1,6})\s+(.+)/)
    if (hm) { blocks.push({ type: "heading", attrs: { level: hm[1].length }, content: inline(hm[2]) }); i++; continue }

    if (line.startsWith("|")) {
      const rows: AdfNode[] = []
      let header = true
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const raw = lines[i++].trim()
        if (/^\|[-| :]+\|$/.test(raw)) continue
        const cells = raw.split("|").slice(1, -1).map(c => c.trim())
        rows.push({ type: "tableRow", content: cells.map(c => ({ type: header ? "tableHeader" : "tableCell", attrs: {}, content: [{ type: "paragraph", content: inline(c) }] })) })
        header = false
      }
      if (rows.length) blocks.push({ type: "table", attrs: { isNumberColumnEnabled: false, layout: "default" }, content: rows })
      continue
    }

    if (/^[-*+]\s/.test(line)) {
      const items: AdfNode[] = []
      while (i < lines.length && /^[-*+]\s/.test(lines[i]))
        items.push({ type: "listItem", content: [{ type: "paragraph", content: inline(lines[i++].replace(/^[-*+]\s+/, "")) }] })
      blocks.push({ type: "bulletList", content: items })
      continue
    }

    if (/^\d+[.)]\s/.test(line)) {
      const items: AdfNode[] = []
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i]))
        items.push({ type: "listItem", content: [{ type: "paragraph", content: inline(lines[i++].replace(/^\d+[.)]\s+/, "")) }] })
      blocks.push({ type: "orderedList", content: items })
      continue
    }

    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^#{1,6}\s/.test(lines[i]) && !/^[-*+]\s/.test(lines[i]) && !/^\d+[.)]\s/.test(lines[i]) && !lines[i].startsWith("```") && !lines[i].startsWith("|"))
      para.push(lines[i++])
    if (para.length) {
      const content: AdfNode[] = []
      para.forEach((l, idx) => { if (idx > 0) content.push({ type: "hardBreak" }); content.push(...inline(l)) })
      blocks.push({ type: "paragraph", content })
    }
  }
  return blocks.length ? blocks : [{ type: "paragraph", content: [{ type: "text", text: md }] }]
}

function extract(node: unknown): string {
  if (!node || typeof node !== "object") return ""
  const n = node as { text?: string; content?: unknown[] }
  if (n.text) return n.text
  return (n.content ?? []).map(extract).join(" ")
}

function context(issue: { key: string; fields: IssueFields }, comment: string, url: string, commentId: string): string {
  return `You are reviewing a Jira issue. Here is the full context:

**Issue**: ${issue.key} - ${issue.fields.summary}
**Link**: ${url}/browse/${issue.key}?focusedCommentId=${commentId}
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

  const token = (await client(dir).jira.token({ directory: dir }).catch(() => null))?.data
  if (token) {
    const auth = btoa(`${cfg.data.email}:${token}`)
    const me = await fetch(`${cfg.data.url}/rest/api/3/myself`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    }).then(r => r.json() as Promise<{ displayName: string; timeZone: string }>).catch(() => null)
    if (me) {
      zones.set(dir, me.timeZone)
      console.log(`[jira] ${cfg.data.project_key}: connected as "${me.displayName}", Jira timezone: ${me.timeZone}`)
    } else console.warn(`[jira] ${cfg.data.project_key}: could not verify Jira connection`)
  }

  console.log(`[jira] Starting poller for ${dir} (project: ${cfg.data.project_key}, interval: ${cfg.data.interval}s)`)
  poll(dir)
  setInterval(() => poll(dir), cfg.data.interval * 1000)
}

console.log("[jira] Poller running. Ctrl+C to stop.")
