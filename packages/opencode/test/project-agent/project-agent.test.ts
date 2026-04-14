import { afterEach, describe, expect, test } from "bun:test"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { ProjectAgent } from "../../src/project-agent/index"

Log.init({ print: false })

afterEach(async () => {
  await resetDatabase()
})

describe("ProjectAgent", () => {
  async function seed() {
    const id = ProjectID.make("test-project-id")
    Database.use((db) =>
      db.insert(ProjectTable).values({
        id,
        worktree: "/tmp/test",
        sandboxes: [],
        time_created: Date.now(),
        time_updated: Date.now(),
      }).run()
    )
    return id
  }

  test("get returns undefined when no config", async () => {
    const pid = await seed()
    expect(ProjectAgent.get(pid)).toBeUndefined()
  })

  test("upsert then get round-trips fields", async () => {
    const pid = await seed()
    const cfg = ProjectAgent.upsert(pid, {
      agent: "build",
      model: "anthropic/claude-sonnet-4-6",
      variant: null,
      auto_accept: true,
    })
    expect(cfg.agent).toBe("build")
    expect(cfg.model).toBe("anthropic/claude-sonnet-4-6")
    expect(cfg.variant).toBeNull()
    expect(cfg.auto_accept).toBe(true)
    const fetched = ProjectAgent.get(pid)
    expect(fetched).toMatchObject(cfg)
  })

  test("resolve merges overrides over defaults, override wins when non-null", async () => {
    const pid = await seed()
    ProjectAgent.upsert(pid, {
      agent: "build",
      model: "anthropic/claude-sonnet-4-6",
      variant: null,
      auto_accept: false,
    })
    const result = ProjectAgent.resolve(pid, { agent: "plan", model: null, variant: null, auto_accept: null })
    expect(result.agent).toBe("plan")
    expect(result.model).toBe("anthropic/claude-sonnet-4-6")
    expect(result.variant).toBeNull()
    expect(result.auto_accept).toBe(false)
  })

  test("resolve returns defaults when overrides omitted", async () => {
    const pid = await seed()
    ProjectAgent.upsert(pid, {
      agent: "build",
      model: "m",
      variant: "high",
      auto_accept: true,
    })
    const result = ProjectAgent.resolve(pid)
    expect(result.agent).toBe("build")
    expect(result.model).toBe("m")
    expect(result.variant).toBe("high")
    expect(result.auto_accept).toBe(true)
  })

  test("resolve returns all-null when no project config and no overrides", async () => {
    const pid = await seed()
    const result = ProjectAgent.resolve(pid)
    expect(result).toEqual({ agent: null, model: null, variant: null, auto_accept: false })
  })
})
