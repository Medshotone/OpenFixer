import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Instance } from "../../project/instance"
import { Teams } from "../../teams/index"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const TeamsRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get Teams config",
        description: "Get the Microsoft Teams integration config for the current project.",
        operationId: "teams.get",
        responses: {
          200: {
            description: "Teams config or null",
            content: { "application/json": { schema: resolver(Teams.Info.nullable()) } },
          },
        },
      }),
      async (c) => {
        const cfg = Teams.get(Instance.project.id)
        return c.json(cfg ?? null)
      },
    )
    .put(
      "/",
      describeRoute({
        summary: "Upsert Teams config",
        description: "Create or update the Microsoft Teams integration config for the current project.",
        operationId: "teams.upsert",
        responses: {
          200: {
            description: "Updated Teams config",
            content: { "application/json": { schema: resolver(Teams.Info) } },
          },
          ...errors(400),
        },
      }),
      validator("json", Teams.UpsertInput),
      async (c) => {
        try {
          const cfg = Teams.upsert(Instance.project.id, c.req.valid("json"))
          return c.json(cfg)
        } catch (err) {
          if (err instanceof Teams.ConflictError) {
            return c.json({ error: err.message }, 400)
          }
          throw err
        }
      },
    )
    .delete(
      "/",
      describeRoute({
        summary: "Delete Teams config",
        description: "Remove the Microsoft Teams integration config for the current project.",
        operationId: "teams.remove",
        responses: {
          200: {
            description: "Deleted",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      async (c) => {
        Teams.remove(Instance.project.id)
        return c.json(true)
      },
    )
    .get(
      "/resolved",
      describeRoute({
        summary: "Get resolved Teams agent config",
        description: "Merged view of project defaults and Teams overrides, for the Teams bot worker.",
        operationId: "teams.resolved",
        responses: {
          200: {
            description: "Resolved config",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    agent: z.string().nullable(),
                    model: z.string().nullable(),
                    variant: z.string().nullable(),
                    auto_accept: z.boolean(),
                  }),
                ),
              },
            },
          },
        },
      }),
      (c) => c.json(Teams.resolve(Instance.project.id)),
    ),
)
