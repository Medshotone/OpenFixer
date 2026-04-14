import z from "zod"
import { Database, eq } from "../storage/db"
import { ProjectAgentConfigTable } from "./project-agent.sql"
import type { ProjectID } from "../project/schema"

export namespace ProjectAgent {
  export const Info = z
    .object({
      project_id: z.string(),
      agent: z.string().nullable(),
      model: z.string().nullable(),
      variant: z.string().nullable(),
      auto_accept: z.boolean(),
    })
    .meta({ ref: "ProjectAgentConfig" })
  export type Info = z.infer<typeof Info>

  export const UpsertInput = z.object({
    agent: z.string().nullable(),
    model: z.string().nullable(),
    variant: z.string().nullable(),
    auto_accept: z.boolean().default(false),
  })
  export type UpsertInput = z.infer<typeof UpsertInput>

  export const Override = z.object({
    agent: z.string().nullable(),
    model: z.string().nullable(),
    variant: z.string().nullable(),
    auto_accept: z.boolean().nullable(),
  })
  export type Override = z.infer<typeof Override>

  export function get(pid: string): Info | undefined {
    return Database.use((db) =>
      db.select().from(ProjectAgentConfigTable).where(eq(ProjectAgentConfigTable.project_id, pid as ProjectID)).get(),
    )
  }

  export function upsert(pid: string, data: UpsertInput): Info {
    Database.use((db) =>
      db
        .insert(ProjectAgentConfigTable)
        .values({ project_id: pid as ProjectID, ...data })
        .onConflictDoUpdate({ target: ProjectAgentConfigTable.project_id, set: data })
        .run(),
    )
    return get(pid)!
  }

  export function resolve(
    pid: string,
    over?: Partial<Override>,
  ): { agent: string | null; model: string | null; variant: string | null; auto_accept: boolean } {
    const base = get(pid)
    return {
      agent: over?.agent ?? base?.agent ?? null,
      model: over?.model ?? base?.model ?? null,
      variant: over?.variant ?? base?.variant ?? null,
      auto_accept: over?.auto_accept ?? base?.auto_accept ?? false,
    }
  }
}
