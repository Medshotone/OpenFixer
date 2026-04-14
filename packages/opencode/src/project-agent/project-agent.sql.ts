import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import { Timestamps } from "../storage/schema.sql"
import type { ProjectID } from "../project/schema"

export const ProjectAgentConfigTable = sqliteTable("project_agent_config", {
  project_id: text()
    .$type<ProjectID>()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  agent: text(),
  model: text(),
  variant: text(),
  auto_accept: integer({ mode: "boolean" }).notNull().default(false),
  ...Timestamps,
})
