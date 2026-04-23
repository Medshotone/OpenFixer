import { afterEach, describe, expect, test } from "bun:test"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { Teams } from "../../src/teams/index"

Log.init({ print: false })

afterEach(async () => {
  await resetDatabase()
})

async function seed(id = "test-project-id", worktree = "/tmp/test") {
  const pid = ProjectID.make(id)
  Database.use((db) =>
    db.insert(ProjectTable).values({
      id: pid,
      worktree,
      sandboxes: [],
      time_created: Date.now(),
      time_updated: Date.now(),
    }).run(),
  )
  return pid
}

describe("Teams CRUD", () => {
  test("upsert stores config and get retrieves it", async () => {
    const pid = await seed()
    const cfg = Teams.upsert(pid, {
      conversation_id: "19:abc123@thread.tacv2",
      service_url: "https://smba.trafficmanager.net/emea/",
      trigger_mode: "always",
      enabled: true,
    })
    expect(cfg.conversation_id).toBe("19:abc123@thread.tacv2")
    expect(cfg.service_url).toBe("https://smba.trafficmanager.net/emea/")
    expect(cfg.trigger_mode).toBe("always")
    expect(cfg.enabled).toBe(true)
    expect(Teams.get(pid)).toMatchObject({ conversation_id: "19:abc123@thread.tacv2" })
  })

  test("upsert applies defaults for trigger_mode and enabled", async () => {
    const pid = await seed()
    const cfg = Teams.upsert(pid, Teams.UpsertInput.parse({
      conversation_id: "c1",
      service_url: "https://smba.trafficmanager.net/emea/",
    }))
    expect(cfg.trigger_mode).toBe("always")
    expect(cfg.enabled).toBe(true)
  })

  test("upsert overwrites existing config", async () => {
    const pid = await seed()
    Teams.upsert(pid, {
      conversation_id: "old",
      service_url: "https://smba.trafficmanager.net/emea/",
      trigger_mode: "always",
      enabled: true,
    })
    Teams.upsert(pid, {
      conversation_id: "new",
      service_url: "https://smba.trafficmanager.net/apac/",
      trigger_mode: "mention",
      enabled: false,
    })
    expect(Teams.get(pid)?.conversation_id).toBe("new")
    expect(Teams.get(pid)?.trigger_mode).toBe("mention")
    expect(Teams.get(pid)?.enabled).toBe(false)
  })

  test("remove deletes config", async () => {
    const pid = await seed()
    Teams.upsert(pid, {
      conversation_id: "c1",
      service_url: "https://smba.trafficmanager.net/emea/",
      trigger_mode: "always",
      enabled: true,
    })
    Teams.remove(pid)
    expect(Teams.get(pid)).toBeUndefined()
  })

  test("get returns undefined for missing config", async () => {
    const pid = await seed()
    expect(Teams.get(pid)).toBeUndefined()
  })

  test("listDirs returns worktree paths of enabled configs only", async () => {
    const p1 = await seed("proj-1", "/tmp/a")
    const p2 = await seed("proj-2", "/tmp/b")
    const p3 = await seed("proj-3", "/tmp/c")
    Teams.upsert(p1, { conversation_id: "c1", service_url: "https://x/", trigger_mode: "always", enabled: true })
    Teams.upsert(p2, { conversation_id: "c2", service_url: "https://x/", trigger_mode: "always", enabled: false })
    Teams.upsert(p3, { conversation_id: "c3", service_url: "https://x/", trigger_mode: "always", enabled: true })
    const dirs = Teams.listDirs()
    expect(dirs.sort()).toEqual(["/tmp/a", "/tmp/c"])
  })

  test("lookup resolves conversation ID to project + worktree", async () => {
    const pid = await seed("proj-1", "/tmp/work")
    Teams.upsert(pid, {
      conversation_id: "19:xyz@thread.tacv2",
      service_url: "https://smba.trafficmanager.net/emea/",
      trigger_mode: "always",
      enabled: true,
    })
    const hit = Teams.lookup("19:xyz@thread.tacv2")
    expect(hit).toEqual({ project_id: pid, worktree: "/tmp/work" })
  })

  test("lookup returns null for unbound conversation", async () => {
    await seed()
    expect(Teams.lookup("19:nosuch@thread.tacv2")).toBeNull()
  })

  test("lookup finds even disabled configs", async () => {
    const pid = await seed("proj-1", "/tmp/work")
    Teams.upsert(pid, {
      conversation_id: "c1",
      service_url: "https://x/",
      trigger_mode: "always",
      enabled: false,
    })
    expect(Teams.lookup("c1")).toEqual({ project_id: pid, worktree: "/tmp/work" })
  })
})
