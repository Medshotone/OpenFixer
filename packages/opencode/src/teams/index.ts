import path from "node:path"
import z from "zod"
import { Database, eq, and, inArray, ne } from "../storage/db"
import { TeamsConfigTable, TeamsConversationTable, TeamsReplyTable, TeamsDmUserTable, TeamsDmStateTable } from "./teams.sql"
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
      dm_user_ids: z.array(z.string()),
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
    dm_user_ids: z.array(z.string().trim().min(1)).optional().default([]),
  })
  export type UpsertInput = z.infer<typeof UpsertInput>

  export class ConflictError extends Error {
    constructor(public readonly conversation_id: string) {
      super(`Conversation ID "${conversation_id}" is already bound to another project`)
      this.name = "TeamsConflictError"
    }
  }

  export class AccessError extends Error {
    constructor(public readonly aad_user_id: string, public readonly project_id: string) {
      super(`User ${aad_user_id} is not allowlisted for project ${project_id}`)
      this.name = "TeamsAccessError"
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
      const conv = db
        .select({ id: TeamsConversationTable.conversation_id })
        .from(TeamsConversationTable)
        .where(eq(TeamsConversationTable.project_id, pid as ProjectID))
        .all()
        .map((r) => r.id)
      const users = db
        .select({ aad: TeamsDmUserTable.aad_user_id })
        .from(TeamsDmUserTable)
        .where(eq(TeamsDmUserTable.project_id, pid as ProjectID))
        .all()
        .map((r) => r.aad)
      return { ...cfg, conversation_ids: conv, dm_user_ids: users } as Info
    })
  }

  export function upsert(pid: string, raw: z.input<typeof UpsertInput>): Info {
    const data = UpsertInput.parse(raw)
    const conv = Array.from(new Set(data.conversation_ids))
    const users = Array.from(new Set(data.dm_user_ids))
    const { conversation_ids: _c, dm_user_ids: _u, ...cfg } = data
    Database.transaction((db) => {
      const conflicts = db
        .select({ id: TeamsConversationTable.conversation_id })
        .from(TeamsConversationTable)
        .where(
          and(
            inArray(TeamsConversationTable.conversation_id, conv),
            ne(TeamsConversationTable.project_id, pid as ProjectID),
          ),
        )
        .all()
      if (conflicts.length) throw new ConflictError(conflicts[0].id)

      db.insert(TeamsConfigTable)
        .values({ project_id: pid as ProjectID, ...cfg })
        .onConflictDoUpdate({ target: TeamsConfigTable.project_id, set: cfg })
        .run()

      db.delete(TeamsConversationTable)
        .where(eq(TeamsConversationTable.project_id, pid as ProjectID))
        .run()
      db.insert(TeamsConversationTable)
        .values(conv.map((id) => ({ conversation_id: id, project_id: pid as ProjectID })))
        .run()

      db.delete(TeamsDmUserTable)
        .where(eq(TeamsDmUserTable.project_id, pid as ProjectID))
        .run()
      if (users.length) {
        db.insert(TeamsDmUserTable)
          .values(users.map((aad) => ({ project_id: pid as ProjectID, aad_user_id: aad })))
          .run()
      }
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

  export function listForUser(aad: string): EnabledProject[] {
    const rows = Database.use((db) =>
      db
        .select({
          project_id: TeamsDmUserTable.project_id,
          name: ProjectTable.name,
          worktree: ProjectTable.worktree,
        })
        .from(TeamsDmUserTable)
        .innerJoin(TeamsConfigTable, eq(TeamsConfigTable.project_id, TeamsDmUserTable.project_id))
        .innerJoin(ProjectTable, eq(ProjectTable.id, TeamsDmUserTable.project_id))
        .where(and(eq(TeamsDmUserTable.aad_user_id, aad), eq(TeamsConfigTable.enabled, true)))
        .all(),
    )
    return rows.map((r) => ({
      project_id: r.project_id,
      name: r.name || path.basename(r.worktree) || r.project_id,
      worktree: r.worktree,
    }))
  }

  export function dmSet(conv: string, pid: string, aad: string): DmState {
    if (!hasAccess(aad, pid)) throw new AccessError(aad, pid)
    Database.use((db) =>
      db
        .insert(TeamsDmStateTable)
        .values({ conversation_id: conv, project_id: pid as ProjectID })
        .onConflictDoUpdate({
          target: TeamsDmStateTable.conversation_id,
          set: { project_id: pid as ProjectID },
        })
        .run(),
    )
    return dmGet(conv)!
  }

  export function dmGet(conv: string): DmState | null {
    const row = Database.use((db) =>
      db
        .select({
          conversation_id: TeamsDmStateTable.conversation_id,
          project_id: TeamsDmStateTable.project_id,
          name: ProjectTable.name,
          worktree: ProjectTable.worktree,
        })
        .from(TeamsDmStateTable)
        .innerJoin(ProjectTable, eq(ProjectTable.id, TeamsDmStateTable.project_id))
        .where(eq(TeamsDmStateTable.conversation_id, conv))
        .get(),
    )
    if (!row) return null
    return {
      conversation_id: row.conversation_id,
      project_id: row.project_id,
      name: row.name || path.basename(row.worktree) || row.project_id,
    }
  }

  export function hasAccess(aad: string, pid: string): boolean {
    return Database.use((db) =>
      db
        .select({ pid: TeamsDmUserTable.project_id })
        .from(TeamsDmUserTable)
        .innerJoin(TeamsConfigTable, eq(TeamsConfigTable.project_id, TeamsDmUserTable.project_id))
        .where(
          and(
            eq(TeamsDmUserTable.aad_user_id, aad),
            eq(TeamsDmUserTable.project_id, pid as ProjectID),
            eq(TeamsConfigTable.enabled, true),
          ),
        )
        .get(),
    ) !== undefined
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
      project_id: z.string().nullable(),
    })
    .meta({ ref: "TeamsReply" })
  export type Reply = z.infer<typeof Reply>

  export const DmState = z
    .object({
      conversation_id: z.string(),
      project_id: z.string(),
      name: z.string(),
    })
    .meta({ ref: "TeamsDmState" })
  export type DmState = z.infer<typeof DmState>

  export const EnabledProject = z
    .object({
      project_id: z.string(),
      name: z.string(),
      worktree: z.string(),
    })
    .meta({ ref: "TeamsEnabledProject" })
  export type EnabledProject = z.infer<typeof EnabledProject>

  export const RecordReplyInput = z.object({
    message_id: z.string().min(1),
    session_id: z.string().min(1),
    worktree: z.string().min(1),
    project_id: z.string().min(1).optional(),
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
          project_id: (data.project_id ?? null) as ProjectID | null,
        })
        .onConflictDoUpdate({
          target: TeamsReplyTable.message_id,
          set: {
            session_id: data.session_id,
            worktree: data.worktree,
            project_id: (data.project_id ?? null) as ProjectID | null,
          },
        })
        .run(),
    )
  }

  export function lookupReply(mid: string): Reply | null {
    const row = Database.use((db) =>
      db
        .select({
          session_id: TeamsReplyTable.session_id,
          worktree: TeamsReplyTable.worktree,
          project_id: TeamsReplyTable.project_id,
        })
        .from(TeamsReplyTable)
        .where(eq(TeamsReplyTable.message_id, mid))
        .get(),
    )
    if (!row) return null
    return { session_id: row.session_id, worktree: row.worktree, project_id: row.project_id ?? null }
  }
}
