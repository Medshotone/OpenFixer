import z from "zod"
import { Database, eq } from "../storage/db"
import { TeamsConfigTable, TeamsReplyTable } from "./teams.sql"
import { ProjectTable } from "../project/project.sql"
import { ProjectAgent } from "../project-agent"
import type { ProjectID } from "../project/schema"

export namespace Teams {
  export const Info = z
    .object({
      project_id: z.string(),
      conversation_id: z.string(),
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
    conversation_id: z.string().min(1),
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

  export const Binding = z
    .object({
      project_id: z.string(),
      worktree: z.string(),
    })
    .meta({ ref: "TeamsBinding" })
  export type Binding = z.infer<typeof Binding>

  export function get(pid: string): Info | undefined {
    return Database.use((db) =>
      db.select().from(TeamsConfigTable).where(eq(TeamsConfigTable.project_id, pid as ProjectID)).get(),
    ) as Info | undefined
  }

  export function upsert(pid: string, data: UpsertInput): Info {
    Database.use((db) =>
      db
        .insert(TeamsConfigTable)
        .values({ project_id: pid as ProjectID, ...data })
        .onConflictDoUpdate({ target: TeamsConfigTable.project_id, set: data })
        .run(),
    )
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
        .select({ project_id: TeamsConfigTable.project_id, worktree: ProjectTable.worktree })
        .from(TeamsConfigTable)
        .innerJoin(ProjectTable, eq(TeamsConfigTable.project_id, ProjectTable.id))
        .where(eq(TeamsConfigTable.conversation_id, conv))
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
