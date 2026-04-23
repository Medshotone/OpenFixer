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
import { createOpencodeClient, type EventPermissionAsked, type ToolPart } from "@opencode-ai/sdk/v2"

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

const global = createOpencodeClient({ baseUrl: base })
const clients = new Map<string, ReturnType<typeof createOpencodeClient>>()
function client(dir: string) {
  if (!clients.has(dir)) clients.set(dir, createOpencodeClient({ baseUrl: base, directory: dir }))
  return clients.get(dir)!
}

const refs = new Map<string, Partial<ConversationReference>>()
const dirOfSession = new Map<string, string>()
const streaming = new Set<string>()

type Step = { tool: string; title: string }
type Turn = { id?: string; steps: Step[]; timer: ReturnType<typeof setTimeout> | null }
const turns = new Map<string, Turn>()

function buildCard(state: { phase: "working" | "done"; steps: Step[] }) {
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
  return CardFactory.adaptiveCard({
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.5",
    body,
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
      const turn = turns.get(p.sessionID)
      if (!turn) {
        const fresh: Turn = { steps: [step], timer: null }
        turns.set(p.sessionID, fresh)
        await adapter
          .continueConversationAsync(appId, ref, async (ctx) => {
            const sent = await ctx.sendActivity(
              MessageFactory.attachment(buildCard({ phase: "working", steps: fresh.steps })),
            )
            if (sent?.id) {
              fresh.id = sent.id
              await record(sent.id, p.sessionID, dir)
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
              attachments: [buildCard({ phase: "working", steps: turn.steps })],
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

function parentId(activity: Activity): string | undefined {
  if (activity.replyToId) return activity.replyToId
  const html = activity.attachments?.find((a) => a.contentType === "text/html")?.content
  if (typeof html !== "string") return undefined
  const m = html.match(/<blockquote\s[^>]*\bitemid="([^"]+)"/)
  return m?.[1]
}

async function record(mid: string | undefined, sid: string, dir: string) {
  if (!mid) return
  await global.global.teams.recordReply({ message_id: mid, session_id: sid, worktree: dir }).catch(() => undefined)
}

class Bot extends TeamsActivityHandler {
  constructor() {
    super()
    this.onMessage(async (ctx, next) => {
      TurnContext.removeRecipientMention(ctx.activity)
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

      const { worktree } = bind.data
      const cfg = await client(worktree).teams.get()
      if (cfg.error || !cfg.data || !cfg.data.enabled) return next()
      if (cfg.data.trigger_mode === "mention" && !mentioned(ctx)) return next()
      if (!text) return next()

      streamDir(worktree)
      refs.set("pending", TurnContext.getConversationReference(ctx.activity))

      const resolved = await client(worktree).teams.resolved()
      const merged = resolved.data ?? { agent: null, model: null, variant: null, auto_accept: false }

      const parent = parentId(ctx.activity)
      let sid: string | undefined
      if (parent) {
        const hit = await global.global.teams.lookupReply({ message_id: parent }).catch(() => undefined)
        if (hit?.data && hit.data.worktree === worktree) sid = hit.data.session_id
      }
      if (!sid) {
        const created = await client(worktree).session.create({ title: text.slice(0, 60) })
        if (created.error || !created.data) {
          await ctx.sendActivity("Sorry, I couldn't create a session. Check the opencode server.")
          return next()
        }
        sid = created.data.id
      }
      const ref = TurnContext.getConversationReference(ctx.activity)
      refs.set(sid, ref)
      refs.delete("pending")
      dirOfSession.set(sid, worktree)

      turns.delete(sid)

      const cancel = merged.auto_accept ? autoAccept(client(worktree), sid, worktree) : () => undefined

      const model = (() => {
        if (!merged.model) return undefined
        const slash = merged.model.indexOf("/")
        if (slash === -1) return undefined
        return { providerID: merged.model.slice(0, slash), modelID: merged.model.slice(slash + 1) }
      })()

      const result = await client(worktree).session.prompt({
        sessionID: sid,
        parts: [{ type: "text", text }],
        ...(merged.agent ? { agent: merged.agent } : {}),
        ...(model ? { model } : {}),
        ...(merged.variant ? { variant: merged.variant } : {}),
      }).catch((e: Error) => ({ error: e, data: undefined }))

      cancel()

      if ("error" in result && result.error) {
        const t = turns.get(sid)
        if (t?.id) {
          if (t.timer) clearTimeout(t.timer)
          await ctx
            .updateActivity({
              id: t.id,
              type: "message",
              attachments: [buildCard({ phase: "done", steps: t.steps })],
            })
            .catch(() => undefined)
        }
        turns.delete(sid)
        await ctx.sendActivity(`Error: ${(result.error as Error).message ?? "unknown"}`)
        return next()
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
            attachments: [buildCard({ phase: "done", steps: turn.steps })],
          })
          .catch(() => undefined)
      }
      turns.delete(sid)

      const sent = await ctx.sendActivity(MessageFactory.text(reply))
      await record(sent?.id, sid, worktree)
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
