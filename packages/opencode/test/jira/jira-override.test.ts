import { afterEach, describe, expect, test } from "bun:test"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { Jira } from "../../src/jira/index"
import { ProjectAgent } from "../../src/project-agent"

Log.init({ print: false })

afterEach(async () => {
  await resetDatabase()
})

async function seed() {
  const id = ProjectID.make("test-project-id")
  Database.use((db) =>
    db.insert(ProjectTable).values({
      id,
      worktree: "/tmp/test",
      sandboxes: [],
      time_created: Date.now(),
      time_updated: Date.now(),
    }).run(),
  )
  return id
}

describe("Jira.resolve", () => {
  test("falls back to project defaults when overrides null", async () => {
    const pid = await seed()
    ProjectAgent.upsert(pid, { agent: "build", model: "m", variant: null, auto_accept: true })
    Jira.upsert(pid, {
      url: "https://x.atlassian.net", email: "a@b.c", token: "t", project_key: "KEY",
      interval: 30, enabled: true,
      agent: null, model: null, variant: null, auto_accept: null,
    })
    expect(Jira.resolve(pid)).toMatchObject({ agent: "build", model: "m", auto_accept: true })
  })

  test("overrides beat project defaults", async () => {
    const pid = await seed()
    ProjectAgent.upsert(pid, { agent: "build", model: "m", variant: null, auto_accept: true })
    Jira.upsert(pid, {
      url: "https://x.atlassian.net", email: "a@b.c", token: "t", project_key: "KEY",
      interval: 30, enabled: true,
      agent: "plan", model: null, variant: null, auto_accept: false,
    })
    expect(Jira.resolve(pid)).toMatchObject({ agent: "plan", model: "m", auto_accept: false })
  })

  test("falls back when Jira upsert omits override fields entirely", async () => {
    const pid = await seed()
    ProjectAgent.upsert(pid, { agent: "build", model: "m", variant: null, auto_accept: true })
    Jira.upsert(pid, {
      url: "https://x.atlassian.net", email: "a@b.c", token: "t", project_key: "KEY",
      interval: 30, enabled: true,
    })
    expect(Jira.resolve(pid)).toEqual({ agent: "build", model: "m", variant: null, auto_accept: true })
  })

  test("override alone resolves without project defaults; auto_accept null floors to false", async () => {
    const pid = await seed()
    Jira.upsert(pid, {
      url: "https://x.atlassian.net", email: "a@b.c", token: "t", project_key: "KEY",
      interval: 30, enabled: true,
      agent: "plan", model: "haiku", variant: "high", auto_accept: null,
    })
    expect(Jira.resolve(pid)).toEqual({ agent: "plan", model: "haiku", variant: "high", auto_accept: false })
  })
})
