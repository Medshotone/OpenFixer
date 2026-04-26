import { afterEach, describe, expect, test } from "bun:test"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { Teams } from "../../src/teams/index"
import { ProjectAgent } from "../../src/project-agent"

Log.init({ print: false })

afterEach(async () => {
  await resetDatabase()
})

async function seed() {
  const pid = ProjectID.make("test-project-id")
  Database.use((db) =>
    db.insert(ProjectTable).values({
      id: pid,
      worktree: "/tmp/test",
      sandboxes: [],
      time_created: Date.now(),
      time_updated: Date.now(),
    }).run(),
  )
  return pid
}

const base = {
  conversation_ids: ["c1"],
  service_url: "https://smba.trafficmanager.net/emea/",
  trigger_mode: "always" as const,
  enabled: true,
}

describe("Teams.resolve", () => {
  test("falls back to project defaults when overrides null", async () => {
    const pid = await seed()
    ProjectAgent.upsert(pid, { agent: "build", model: "m", variant: null, auto_accept: true })
    Teams.upsert(pid, { ...base, agent: null, model: null, variant: null, auto_accept: null })
    expect(Teams.resolve(pid)).toMatchObject({ agent: "build", model: "m", auto_accept: true })
  })

  test("overrides beat project defaults", async () => {
    const pid = await seed()
    ProjectAgent.upsert(pid, { agent: "build", model: "m", variant: null, auto_accept: true })
    Teams.upsert(pid, { ...base, agent: "plan", model: null, variant: null, auto_accept: false })
    expect(Teams.resolve(pid)).toMatchObject({ agent: "plan", model: "m", auto_accept: false })
  })

  test("falls back when Teams upsert omits override fields entirely", async () => {
    const pid = await seed()
    ProjectAgent.upsert(pid, { agent: "build", model: "m", variant: null, auto_accept: true })
    Teams.upsert(pid, base)
    expect(Teams.resolve(pid)).toEqual({ agent: "build", model: "m", variant: null, auto_accept: true })
  })

  test("override alone resolves without project defaults; auto_accept null floors to false", async () => {
    const pid = await seed()
    Teams.upsert(pid, { ...base, agent: "plan", model: "haiku", variant: "high", auto_accept: null })
    expect(Teams.resolve(pid)).toEqual({ agent: "plan", model: "haiku", variant: "high", auto_accept: false })
  })

  test("resolves with no Teams config and no defaults", async () => {
    const pid = await seed()
    expect(Teams.resolve(pid)).toEqual({ agent: null, model: null, variant: null, auto_accept: false })
  })
})
