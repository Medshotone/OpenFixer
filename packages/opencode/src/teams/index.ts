import z from "zod"
import { Database, eq, and, inArray, ne } from "../storage/db"
import { TeamsConfigTable, TeamsConversationTable, TeamsReplyTable } from "./teams.sql"
import { ProjectTable } from "../project/project.sql"
import { ProjectAgent } from "../project-agent"
import type { ProjectID } from "../project/schema"

export namespace Teams {
  export const Info = z
    .object({
      project_id: z.string(),
      conversation_ids: z.array(z.string()),
      service_url: z.string(),
      tenant_id: z.string().nullable(),
      trigger_mode: z.enum(["always", "mention"]),
      enabled: z.boolean(),
      agent: z.string().nullable(),
      model: z.string().nullable(),
      variant: z.string().nullable(),
      auto_accept: z.boolean().nullable(),
    })
    .meta({ ref: "TeamsConfig" })
  export type Info = z.infer<typeof Info>

  export const UpsertInput = z.object({
    conversation_ids: z.array(z.string().trim().min(1)).min(1),
    service_url: z.string().url(),
    tenant_id: z.string().nullable().optional(),
    trigger_mode: z.enum(["always", "mention"]).default("always"),
    enabled: z.boolean().default(true),
    agent: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    variant: z.string().nullable().optional(),
    auto_accept: z.boolean().nullable().optional(),
  })
  export type UpsertInput = z.infer<typeof UpsertInput>

  export class ConflictError extends Error {
    constructor(public readonly conversation_id: string) {
      super(`Conversation ID "${conversation_id}" is already bound to another project`)
      this.name = "TeamsConflictError"
    }
  }

  export const Binding = z
    .object({
      project_id: z.string(),
      worktree: z.string(),
    })
    .meta({ ref: "TeamsBinding" })
  export type Binding = z.infer<typeof Binding>

  export function get(pid: string): Info | undefined {
    return Database.use((db) => {
      const cfg = db
        .select()
        .from(TeamsConfigTable)
        .where(eq(TeamsConfigTable.project_id, pid as ProjectID))
        .get()
      if (!cfg) return undefined
      const ids = db
        .select({ id: TeamsConversationTable.conversation_id })
        .from(TeamsConversationTable)
        .where(eq(TeamsConversationTable.project_id, pid as ProjectID))
        .all()
        .map((r) => r.id)
      return { ...cfg, conversation_ids: ids } as Info
    })
  }

  export function upsert(pid: string, data: UpsertInput): Info {
    const ids = Array.from(new Set(data.conversation_ids))
    const { conversation_ids: _, ...cfgFields } = data
    Database.transaction((db) => {
      const conflicts = db
        .select({ id: TeamsConversationTable.conversation_id })
        .from(TeamsConversationTable)
        .where(
          and(
            inArray(TeamsConversationTable.conversation_id, ids),
            ne(TeamsConversationTable.project_id, pid as ProjectID),
          ),
        )
        .all()
      if (conflicts.length) throw new ConflictError(conflicts[0].id)

      db.insert(TeamsConfigTable)
        .values({ project_id: pid as ProjectID, ...cfgFields })
        .onConflictDoUpdate({ target: TeamsConfigTable.project_id, set: cfgFields })
        .run()

      db.delete(TeamsConversationTable)
        .where(eq(TeamsConversationTable.project_id, pid as ProjectID))
        .run()

      db.insert(TeamsConversationTable)
        .values(ids.map((id) => ({ conversation_id: id, project_id: pid as ProjectID })))
        .run()
    })
    return get(pid)!
  }

  export function remove(pid: string): void {
    Database.use((db) =>
      db.delete(TeamsConfigTable).where(eq(TeamsConfigTable.project_id, pid as ProjectID)).run(),
    )
  }

  export function listDirs(): string[] {
    return Database.use((db) =>
      db
        .select({ worktree: ProjectTable.worktree })
        .from(TeamsConfigTable)
        .innerJoin(ProjectTable, eq(TeamsConfigTable.project_id, ProjectTable.id))
        .where(eq(TeamsConfigTable.enabled, true))
        .all(),
    ).map((r) => r.worktree)
  }

  export function lookup(conv: string): Binding | null {
    const row = Database.use((db) =>
      db
        .select({
          project_id: TeamsConversationTable.project_id,
          worktree: ProjectTable.worktree,
        })
        .from(TeamsConversationTable)
        .innerJoin(ProjectTable, eq(TeamsConversationTable.project_id, ProjectTable.id))
        .where(eq(TeamsConversationTable.conversation_id, conv))
        .get(),
    )
    return row ? { project_id: row.project_id, worktree: row.worktree } : null
  }

  export function resolve(pid: string) {
    const cfg = get(pid)
    return ProjectAgent.resolve(pid, {
      agent: cfg?.agent ?? null,
      model: cfg?.model ?? null,
      variant: cfg?.variant ?? null,
      auto_accept: cfg?.auto_accept ?? null,
    })
  }

  export const Reply = z
    .object({
      session_id: z.string(),
      worktree: z.string(),
    })
    .meta({ ref: "TeamsReply" })
  export type Reply = z.infer<typeof Reply>

  export const RecordReplyInput = z.object({
    message_id: z.string().min(1),
    session_id: z.string().min(1),
    worktree: z.string().min(1),
  })
  export type RecordReplyInput = z.infer<typeof RecordReplyInput>

  export function recordReply(data: RecordReplyInput): void {
    Database.use((db) =>
      db
        .insert(TeamsReplyTable)
        .values({
          message_id: data.message_id,
          session_id: data.session_id,
          worktree: data.worktree,
        })
        .onConflictDoUpdate({
          target: TeamsReplyTable.message_id,
          set: { session_id: data.session_id, worktree: data.worktree },
        })
        .run(),
    )
  }

  export function lookupReply(mid: string): Reply | null {
    const row = Database.use((db) =>
      db
        .select({ session_id: TeamsReplyTable.session_id, worktree: TeamsReplyTable.worktree })
        .from(TeamsReplyTable)
        .where(eq(TeamsReplyTable.message_id, mid))
        .get(),
    )
    return row ?? null
  }
}
