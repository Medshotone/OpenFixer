import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Instance } from "../../project/instance"
import { Jira } from "../../jira/index"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const JiraRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get Jira config",
        description: "Get the Jira integration config for the current project.",
        operationId: "jira.get",
        responses: {
          200: {
            description: "Jira config or null",
            content: { "application/json": { schema: resolver(Jira.Info.omit({ token: true }).nullable()) } },
          },
        },
      }),
      async (c) => {
        const cfg = Jira.get(Instance.project.id)
        if (!cfg) return c.json(null)
        const { token: _, ...safe } = cfg
        return c.json(safe)
      },
    )
    .put(
      "/",
      describeRoute({
        summary: "Upsert Jira config",
        description: "Create or update the Jira integration config for the current project.",
        operationId: "jira.upsert",
        responses: {
          200: {
            description: "Updated Jira config",
            content: { "application/json": { schema: resolver(Jira.Info.omit({ token: true })) } },
          },
          ...errors(400),
        },
      }),
      validator("json", Jira.UpsertInput),
      async (c) => {
        const cfg = Jira.upsert(Instance.project.id, c.req.valid("json"))
        const { token: _, ...safe } = cfg
        return c.json(safe)
      },
    )
    .delete(
      "/",
      describeRoute({
        summary: "Delete Jira config",
        description: "Remove the Jira integration config for the current project.",
        operationId: "jira.remove",
        responses: {
          200: {
            description: "Deleted",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      async (c) => {
        Jira.remove(Instance.project.id)
        return c.json(true)
      },
    )
    .post(
      "/test",
      describeRoute({
        summary: "Test Jira connection",
        description: "Verify that the provided Jira credentials can access the specified project.",
        operationId: "jira.test",
        responses: {
          200: {
            description: "Test result",
            content: { "application/json": { schema: resolver(z.object({ ok: z.boolean() })) } },
          },
          ...errors(400),
        },
      }),
      validator("json", Jira.UpsertInput.pick({ url: true, email: true, token: true, project_key: true })),
      async (c) => {
        const { url, email, token, project_key } = c.req.valid("json")
        const res = await fetch(`${url}/rest/api/3/project/${project_key}`, {
          headers: { Authorization: `Basic ${btoa(`${email}:${token}`)}`, Accept: "application/json" },
        }).catch(() => null)
        return c.json({ ok: res?.ok ?? false })
      },
    ),
)
