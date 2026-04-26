import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import { Timestamps } from "../storage/schema.sql"
import type { ProjectID } from "../project/schema"

export const TeamsConfigTable = sqliteTable("teams_config", {
  project_id: text()
    .$type<ProjectID>()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  service_url: text().notNull(),
  tenant_id: text(),
  trigger_mode: text().notNull().default("always"),
  enabled: integer({ mode: "boolean" }).notNull().default(true),
  agent: text(),
  model: text(),
  variant: text(),
  auto_accept: integer({ mode: "boolean" }),
  ...Timestamps,
})

export const TeamsConversationTable = sqliteTable("teams_conversation", {
  conversation_id: text().primaryKey(),
  project_id: text()
    .$type<ProjectID>()
    .notNull()
    .references(() => TeamsConfigTable.project_id, { onDelete: "cascade" }),
  ...Timestamps,
})

export const TeamsReplyTable = sqliteTable("teams_reply", {
  message_id: text().primaryKey(),
  session_id: text().notNull(),
  worktree: text().notNull(),
  ...Timestamps,
})
