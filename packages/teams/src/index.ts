import { createServer } from "node:http"
import {
  CardFactory,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationServiceClientCredentialFactory,
  MessageFactory,
  TeamsActivityHandler,
  TurnContext,
  type Activity,
  type ConversationReference,
} from "botbuilder"
import { createOpencodeClient, type EventPermissionAsked, type ToolPart, type TeamsEnabledProject, type TeamsDmState } from "@opencode-ai/sdk/v2"

const base = process.env.OPENCODE_SERVER_URL ?? "http://127.0.0.1:4096"
const port = Number(process.env.PORT ?? 3978)
const appId = process.env.MICROSOFT_APP_ID ?? ""

if (!appId) console.warn("[teams] MICROSOFT_APP_ID is not set — the bot will reject incoming activities")

const credentials = new ConfigurationServiceClientCredentialFactory({
  MicrosoftAppId: appId,
  MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD ?? "",
  MicrosoftAppType: process.env.MICROSOFT_APP_TYPE ?? "MultiTenant",
  MicrosoftAppTenantId: process.env.MICROSOFT_APP_TENANT_ID ?? "",
})
const auth = new ConfigurationBotFrameworkAuthentication({}, credentials)

class Adapter extends CloudAdapter {
  invoke(authHeader: string, activity: Activity, logic: (ctx: TurnContext) => Promise<void>) {
    return this.processActivity(authHeader, activity, logic)
  }
}
const adapter = new Adapter(auth)

adapter.onTurnError = async (ctx, err) => {
  console.error("[teams] turn error:", err)
  await ctx.sendActivity("Sorry, something went wrong handling your message.").catch(() => undefined)
}

const opencodeUser = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
const opencodePass = process.env.OPENCODE_SERVER_PASSWORD
const opencodeHeaders = opencodePass
  ? { Authorization: `Basic ${Buffer.from(`${opencodeUser}:${opencodePass}`).toString("base64")}` }
  : undefined

const global = createOpencodeClient({ baseUrl: base, headers: opencodeHeaders })
const clients = new Map<string, ReturnType<typeof createOpencodeClient>>()
function client(dir: string) {
  if (!clients.has(dir)) clients.set(dir, createOpencodeClient({ baseUrl: base, directory: dir, headers: opencodeHeaders }))
  return clients.get(dir)!
}

const refs = new Map<string, Partial<ConversationReference>>()
const dirOfSession = new Map<string, string>()
const projectOfSession = new Map<string, { id: string; name: string }>()
const streaming = new Set<string>()

type Step = { tool: string; title: string }
type Turn = { id?: string; steps: Step[]; timer: ReturnType<typeof setTimeout> | null }
const turns = new Map<string, Turn>()

export function buildCard(state: { phase: "working" | "done"; steps: Step[]; projectName?: string }) {
  const n = state.steps.length
  const header =
    state.phase === "working"
      ? `Working… (${n} step${n === 1 ? "" : "s"})`
      : `✓ Done (${n} step${n === 1 ? "" : "s"})`
  const body: object[] = [{ type: "TextBlock", text: header, weight: "Bolder", wrap: true }]
  if (n > 0) {
    body.push({
      type: "ActionSet",
      actions: [
        {
          type: "Action.ToggleVisibility",
          title: `Show steps (${n})`,
          targetElements: ["steps"],
        },
      ],
    })
    body.push({
      type: "Container",
      id: "steps",
      isVisible: false,
      items: state.steps.map((s) => ({
        type: "TextBlock",
        text: `• **${s.tool}** — ${s.title}`,
        wrap: true,
        spacing: "Small",
      })),
    })
  }
  if (state.projectName) {
    body.push({
      type: "TextBlock",
      text: `Project: ${state.projectName}`,
      isSubtle: true,
      size: "Small",
      weight: "Lighter",
      spacing: "Medium",
      wrap: true,
    })
  }
  return CardFactory.adaptiveCard({
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.5",
    body,
  })
}

type PickerProject = { project_id: string; name: string; worktree: string }

export function buildPicker(projects: PickerProject[], currentId?: string) {
  const body: object[] = [{ type: "TextBlock", text: "Pick a project:", wrap: true, weight: "Bolder" }]
  if (projects.length <= 4) {
    const actions = projects.map((p) => ({
      type: "Action.Submit",
      title: p.project_id === currentId ? `${p.name}  ✓` : p.name,
      data: { action: "switchProject", project_id: p.project_id },
    }))
    return CardFactory.adaptiveCard({
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      type: "AdaptiveCard",
      version: "1.5",
      body,
      actions,
    })
  }
  body.push({
    type: "Input.ChoiceSet",
    id: "project_id",
    style: "compact",
    value: currentId,
    choices: projects.map((p) => ({ title: p.name, value: p.project_id })),
  })
  return CardFactory.adaptiveCard({
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.5",
    body,
    actions: [{ type: "Action.Submit", title: "Use", data: { action: "switchProject" } }],
  })
}

function streamDir(dir: string) {
  if (streaming.has(dir)) return
  streaming.add(dir)
  ;(async () => {
    const { stream } = await client(dir).event.subscribe()
    for await (const e of stream) {
      if (e?.type !== "message.part.updated") continue
      const part = e.properties.part
      if (part.type !== "tool") continue
      const p = part as ToolPart
      if (p.state.status !== "completed") continue
      const ref = refs.get(p.sessionID)
      if (!ref) continue
      const step: Step = { tool: p.tool, title: p.state.title }
      const proj = projectOfSession.get(p.sessionID)
      const personal = ref.conversation?.conversationType === "personal"
      const name = personal ? proj?.name : undefined
      const turn = turns.get(p.sessionID)
      if (!turn) {
        const fresh: Turn = { steps: [step], timer: null }
        turns.set(p.sessionID, fresh)
        await adapter
          .continueConversationAsync(appId, ref, async (ctx) => {
            const sent = await ctx.sendActivity(
              MessageFactory.attachment(buildCard({ phase: "working", steps: fresh.steps, projectName: name })),
            )
            if (sent?.id) {
              fresh.id = sent.id
              await record(sent.id, p.sessionID, dir, proj?.id)
            }
          })
          .catch(() => undefined)
        continue
      }
      turn.steps.push(step)
      if (!turn.id || turn.timer) continue
      turn.timer = setTimeout(() => {
        turn.timer = null
        const r = refs.get(p.sessionID)
        if (!r || !turn.id) return
        adapter
          .continueConversationAsync(appId, r, async (ctx) => {
            if (!turn.id) return
            await ctx.updateActivity({
              id: turn.id,
              type: "message",
              attachments: [buildCard({ phase: "working", steps: turn.steps, projectName: name })],
            })
          })
          .catch(() => undefined)
      }, 500)
    }
  })().catch((err) => {
    console.error(`[teams] event stream for ${dir} crashed:`, err)
    streaming.delete(dir)
  })
}

function autoAccept(wc: ReturnType<typeof createOpencodeClient>, sid: string, wdir: string) {
  let cancelled = false
  ;(async () => {
    const { stream } = await wc.event.subscribe()
    for await (const e of stream) {
      if (cancelled) break
      if (e?.type !== "permission.asked") continue
      const req = (e as EventPermissionAsked).properties
      if (req.sessionID !== sid) continue
      await wc.permission.reply({ requestID: req.id, reply: "always", directory: wdir }).catch(() => undefined)
    }
  })().catch(() => undefined)
  return () => { cancelled = true }
}

function mentioned(ctx: TurnContext) {
  const ents = ctx.activity.entities ?? []
  return ents.some((x) => x.type === "mention" && (x as { mentioned?: { id?: string } }).mentioned?.id === appId)
}

export function parsePromptCommand(text: string): "id" | "project" | null {
  const m = text.trim().toLowerCase()
  if (m === "/id") return "id"
  if (m === "/project") return "project"
  return null
}

export function withFooter(text: string, name: string): string {
  return `${text}\n\n_Project: ${name}_`
}

function parentId(activity: Activity): string | undefined {
  if (activity.replyToId) return activity.replyToId
  const html = activity.attachments?.find((a) => a.contentType === "text/html")?.content
  if (typeof html !== "string") return undefined
  const m = html.match(/<blockquote\s[^>]*\bitemid="([^"]+)"/)
  return m?.[1]
}

async function record(mid: string | undefined, sid: string, dir: string, pid?: string) {
  if (!mid) return
  await global.global.teams.recordReply({
    message_id: mid,
    session_id: sid,
    worktree: dir,
    ...(pid ? { project_id: pid } : {}),
  }).catch(() => undefined)
}

async function handleSwitchSubmit(ctx: TurnContext) {
  const aad = ctx.activity.from?.aadObjectId ?? ""
  const conv = ctx.activity.conversation.id
  const value = (ctx.activity.value ?? {}) as { action?: string; project_id?: string }
  const pid = value.project_id ?? ""
  if (!aad || !pid) {
    await ctx.sendActivity("Could not switch project — missing user or project ID.")
    return
  }
  const result = await global.global.teams.dmSet({
    conversation: conv,
    project_id: pid,
    aad_user_id: aad,
  }).catch((e: Error) => ({ error: e, data: undefined }))
  if ("error" in result && result.error) {
    await ctx.sendActivity("That project is no longer available to you. Pick another.")
    const remaining = await global.global.teams.dmProjectsForUser({ aad_user_id: aad }).catch(() => ({ data: [] as TeamsEnabledProject[] }))
    if (remaining.data?.length) {
      await ctx.sendActivity(MessageFactory.attachment(buildPicker(remaining.data)))
    }
    return
  }
  const state = result.data as TeamsDmState
  await ctx.sendActivity(`Now talking about *${state.name}*. Send a message anytime.`)
}

async function welcomePersonal(ctx: TurnContext) {
  if (ctx.activity.conversation.conversationType !== "personal") return
  const added = ctx.activity.membersAdded ?? []
  for (const m of added) {
    if (m.id === ctx.activity.recipient.id) continue
    const aad = m.aadObjectId ?? ""
    if (!aad) continue
    const list = await global.global.teams.dmProjectsForUser({ aad_user_id: aad }).catch(() => ({ data: [] as TeamsEnabledProject[] }))
    if (list.data?.length) {
      await ctx.sendActivity(MessageFactory.attachment(buildPicker(list.data)))
      continue
    }
    await ctx.sendActivity(
      `Welcome! Your ID is \`${aad}\`. Ask your OpenFixer admin to add you to a project, ` +
      `then type \`/project\` to pick one. Type \`/id\` anytime to see this ID again.`,
    )
  }
}

async function handleDmMessage(ctx: TurnContext) {
  const text = (ctx.activity.text ?? "").trim()
  const aad = ctx.activity.from?.aadObjectId ?? ""
  const conv = ctx.activity.conversation.id

  if (!aad) {
    await ctx.sendActivity("Could not identify your AAD user ID. Try again from a different Teams session.")
    return
  }

  const cmd = parsePromptCommand(text)
  if (cmd === "id") {
    await ctx.sendActivity(`Your AAD user ID is \`${aad}\`.`)
    return
  }

  const list = await global.global.teams
    .dmProjectsForUser({ aad_user_id: aad })
    .catch(() => ({ data: [] as TeamsEnabledProject[] }))
  const projects = list.data ?? []
  const allowed = new Set(projects.map((p) => p.project_id))

  if (cmd === "project") {
    if (!allowed.size) {
      await ctx.sendActivity(
        `You're not allowlisted for any project yet. Your ID: \`${aad}\`. Ask an admin to add you.`,
      )
      return
    }
    const current = await global.global.teams
      .dmGet({ conversation: conv })
      .catch(() => ({ data: null as TeamsDmState | null }))
    await ctx.sendActivity(MessageFactory.attachment(buildPicker(projects, current.data?.project_id)))
    return
  }

  if (!text) return

  const parent = parentId(ctx.activity)
  let sid: string | undefined
  let worktree: string | undefined
  let pid: string | undefined
  let name: string | undefined

  if (parent) {
    const hit = await global.global.teams.lookupReply({ message_id: parent }).catch(() => undefined)
    if (hit?.data && hit.data.project_id && allowed.has(hit.data.project_id)) {
      sid = hit.data.session_id
      worktree = hit.data.worktree
      pid = hit.data.project_id
      name = projects.find((p) => p.project_id === pid)?.name
    }
  }

  if (!sid) {
    const dm = await global.global.teams
      .dmGet({ conversation: conv })
      .catch(() => ({ data: null as TeamsDmState | null }))
    if (dm.data && allowed.has(dm.data.project_id)) {
      const proj = projects.find((p) => p.project_id === dm.data!.project_id)
      if (proj) {
        worktree = proj.worktree
        pid = proj.project_id
        name = proj.name
      }
    }
  }

  if (!sid && !worktree) {
    if (allowed.size) {
      await ctx.sendActivity(MessageFactory.attachment(buildPicker(projects)))
      return
    }
    await ctx.sendActivity(
      `You're not allowlisted for any project yet. Your ID: \`${aad}\`. Ask an admin to add you.`,
    )
    return
  }

  await runPrompt(ctx, { sid, worktree: worktree!, projectId: pid!, projectName: name!, text })
}

async function runPrompt(
  ctx: TurnContext,
  opts: { sid?: string; worktree: string; projectId: string; projectName?: string; text: string },
) {
  const { worktree, projectId, projectName, text } = opts
  const cfg = await client(worktree).teams.get()
  if (cfg.error || !cfg.data || !cfg.data.enabled) return
  if (
    cfg.data.trigger_mode === "mention" &&
    !mentioned(ctx) &&
    ctx.activity.conversation.conversationType !== "personal"
  )
    return

  streamDir(worktree)
  refs.set("pending", TurnContext.getConversationReference(ctx.activity))

  const resolved = await client(worktree).teams.resolved()
  const merged = resolved.data ?? { agent: null, model: null, variant: null, auto_accept: false }

  let sid = opts.sid
  if (!sid) {
    const created = await client(worktree).session.create({ title: text.slice(0, 60) })
    if (created.error || !created.data) {
      await ctx.sendActivity("Sorry, I couldn't create a session. Check the opencode server.")
      return
    }
    sid = created.data.id
  }

  const ref = TurnContext.getConversationReference(ctx.activity)
  refs.set(sid, ref)
  refs.delete("pending")
  dirOfSession.set(sid, worktree)
  turns.delete(sid)

  projectOfSession.set(sid, { id: projectId, name: projectName ?? "" })

  const cancel = merged.auto_accept ? autoAccept(client(worktree), sid, worktree) : () => undefined

  const model = (() => {
    if (!merged.model) return undefined
    const slash = merged.model.indexOf("/")
    if (slash === -1) return undefined
    return { providerID: merged.model.slice(0, slash), modelID: merged.model.slice(slash + 1) }
  })()

  const result = await client(worktree)
    .session.prompt({
      sessionID: sid,
      parts: [{ type: "text", text }],
      ...(merged.agent ? { agent: merged.agent } : {}),
      ...(model ? { model } : {}),
      ...(merged.variant ? { variant: merged.variant } : {}),
    })
    .catch((e: Error) => ({ error: e, data: undefined }))

  cancel()

  const personal = ctx.activity.conversation.conversationType === "personal"
  const footer = personal ? projectName : undefined

  if ("error" in result && result.error) {
    const t = turns.get(sid)
    if (t?.id) {
      if (t.timer) clearTimeout(t.timer)
      await ctx
        .updateActivity({
          id: t.id,
          type: "message",
          attachments: [buildCard({ phase: "done", steps: t.steps, projectName: footer })],
        })
        .catch(() => undefined)
    }
    turns.delete(sid)
    const errText = `Error: ${(result.error as Error).message ?? "unknown"}`
    await ctx.sendActivity(footer ? withFooter(errText, footer) : errText)
    return
  }

  const data = result.data as { info?: { content?: string }; parts?: { type: string; text?: string }[] } | undefined
  const reply =
    data?.info?.content ??
    data?.parts?.filter((p) => p.type === "text" && p.text).map((p) => p.text!).join("\n") ??
    "I got your message but didn't produce a response."

  const turn = turns.get(sid)
  if (turn?.id) {
    if (turn.timer) clearTimeout(turn.timer)
    await ctx
      .updateActivity({
        id: turn.id,
        type: "message",
        attachments: [buildCard({ phase: "done", steps: turn.steps, projectName: footer })],
      })
      .catch(() => undefined)
  }
  turns.delete(sid)

  const finalText = footer ? withFooter(reply, footer) : reply
  const sent = await ctx.sendActivity(MessageFactory.text(finalText))
  await record(sent?.id, sid, worktree, projectId)
}

class Bot extends TeamsActivityHandler {
  constructor() {
    super()
    this.onMessage(async (ctx, next) => {
      TurnContext.removeRecipientMention(ctx.activity)

      const value = (ctx.activity.value ?? {}) as { action?: string }
      if (value.action === "switchProject") {
        await handleSwitchSubmit(ctx)
        return next()
      }

      if (ctx.activity.conversation.conversationType === "personal") {
        await handleDmMessage(ctx)
        return next()
      }

      const text = (ctx.activity.text ?? "").trim()
      const conv = ctx.activity.conversation.id
      const bind = await global.global.teams.lookup({ conversation: conv })
      if (bind.error || !bind.data) {
        const serviceUrl = ctx.activity.serviceUrl ?? ""
        await ctx.sendActivity(
          MessageFactory.text(
            `I'm not linked to any OpenFixer project yet. Paste these into the project's Teams Settings:\n\n` +
              `*Conversation ID:* \`${conv}\`\n*Service URL:* \`${serviceUrl}\``,
          ),
        )
        return next()
      }
      if (!text) return next()

      const { worktree, project_id } = bind.data
      let sid: string | undefined
      const parent = parentId(ctx.activity)
      if (parent) {
        const hit = await global.global.teams.lookupReply({ message_id: parent }).catch(() => undefined)
        if (hit?.data && hit.data.worktree === worktree) sid = hit.data.session_id
      }

      await runPrompt(ctx, { sid, worktree, projectId: project_id, text })
      return next()
    })

    this.onMembersAdded(async (ctx, next) => {
      await welcomePersonal(ctx)
      return next()
    })
  }
}

const bot = new Bot()

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/messages") {
    const raw = await readBody(req)
    const activity = (() => {
      try { return JSON.parse(raw) as Activity } catch { return null }
    })()
    if (!activity) {
      res.writeHead(400, { "content-type": "text/plain" }).end("invalid JSON")
      return
    }
    const authHeader = req.headers.authorization ?? ""
    await adapter
      .invoke(authHeader, activity, (ctx) => bot.run(ctx))
      .then(() => {
        if (!res.headersSent) res.writeHead(200).end()
      })
      .catch((err: Error & { statusCode?: number }) => {
        console.error("[teams] processActivity failed:", err)
        if (!res.headersSent) res.writeHead(err.statusCode ?? 500).end()
      })
    return
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok")
    return
  }
  res.writeHead(404).end()
})

server.listen(port, async () => {
  console.log(`[teams] bot listening on :${port}/api/messages`)
  console.log(`[teams] opencode server: ${base}`)
  const dirs = await global.global.teams.dirs().then((r) => r.data ?? []).catch(() => [] as string[])
  console.log(`[teams] starting event streams for ${dirs.length} bound project(s)`)
  dirs.forEach(streamDir)
})
