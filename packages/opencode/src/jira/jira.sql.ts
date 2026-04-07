import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import { Timestamps } from "../storage/schema.sql"
import type { ProjectID } from "../project/schema"

export const JiraConfigTable = sqliteTable("jira_config", {
  project_id: text()
    .$type<ProjectID>()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  url: text().notNull(),
  email: text().notNull(),
  token: text().notNull(),
  project_key: text().notNull(),
  interval: integer().notNull().default(30),
  enabled: integer({ mode: "boolean" }).notNull().default(true),
  bitbucket_token: text(),
  ...Timestamps,
})
