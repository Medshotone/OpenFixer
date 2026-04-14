import z from "zod"
import { Database, eq } from "../storage/db"
import { JiraConfigTable } from "./jira.sql"
import { ProjectTable } from "../project/project.sql"
import { ProjectAgent } from "../project-agent"
import type { ProjectID } from "../project/schema"

export namespace Jira {
  export const Info = z
    .object({
      project_id: z.string(),
      url: z.string(),
      email: z.string(),
      token: z.string(),
      project_key: z.string(),
      interval: z.number(),
      enabled: z.boolean(),
      bitbucket_token: z.string().nullable(),
      bitbucket_user: z.string().nullable(),
      branch: z.string().nullable(),
      agent: z.string().nullable(),
      model: z.string().nullable(),
      variant: z.string().nullable(),
      auto_accept: z.boolean().nullable(),
    })
    .meta({ ref: "JiraConfig" })
  export type Info = z.infer<typeof Info>

  export const UpsertInput = z.object({
    url: z.string().url(),
    email: z.string().email(),
    token: z.string().min(1),
    project_key: z.string().min(1),
    interval: z.number().int().min(10).max(300).default(30),
    enabled: z.boolean().default(true),
    bitbucket_token: z.string().nullable().optional(),
    bitbucket_user: z.string().nullable().optional(),
    branch: z.string().nullable().optional(),
    agent: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    variant: z.string().nullable().optional(),
    auto_accept: z.boolean().nullable().optional(),
  })
  export type UpsertInput = z.infer<typeof UpsertInput>

  export function get(pid: string): Info | undefined {
    return Database.use((db) =>
      db.select().from(JiraConfigTable).where(eq(JiraConfigTable.project_id, pid as ProjectID)).get(),
    )
  }

  export function upsert(pid: string, data: UpsertInput): Info {
    Database.use((db) =>
      db
        .insert(JiraConfigTable)
        .values({ project_id: pid as ProjectID, ...data })
        .onConflictDoUpdate({ target: JiraConfigTable.project_id, set: data })
        .run(),
    )
    return get(pid)!
  }

  export function remove(pid: string): void {
    Database.use((db) =>
      db.delete(JiraConfigTable).where(eq(JiraConfigTable.project_id, pid as ProjectID)).run(),
    )
  }

  export function listDirs(): string[] {
    return Database.use((db) =>
      db
        .select({ worktree: ProjectTable.worktree })
        .from(JiraConfigTable)
        .innerJoin(ProjectTable, eq(JiraConfigTable.project_id, ProjectTable.id))
        .where(eq(JiraConfigTable.enabled, true))
        .all(),
    ).map((r) => r.worktree)
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
}
