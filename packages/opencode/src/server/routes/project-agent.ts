import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Instance } from "../../project/instance"
import { ProjectAgent } from "../../project-agent"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const ProjectAgentRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get project agent config",
        description: "Default agent/model/variant/auto-accept for the current project.",
        operationId: "projectAgent.get",
        responses: {
          200: {
            description: "Project agent config or null",
            content: { "application/json": { schema: resolver(ProjectAgent.Info.nullable()) } },
          },
        },
      }),
      (c) => c.json(ProjectAgent.get(Instance.project.id) ?? null),
    )
    .put(
      "/",
      describeRoute({
        summary: "Upsert project agent config",
        description: "Create or update the project-level agent defaults.",
        operationId: "projectAgent.upsert",
        responses: {
          200: {
            description: "Updated config",
            content: { "application/json": { schema: resolver(ProjectAgent.Info) } },
          },
          ...errors(400),
        },
      }),
      validator("json", ProjectAgent.UpsertInput),
      (c) => c.json(ProjectAgent.upsert(Instance.project.id, c.req.valid("json"))),
    ),
)
