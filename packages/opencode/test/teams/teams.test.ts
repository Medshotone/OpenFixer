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
      conversation_ids: ["19:abc123@thread.tacv2"],
      service_url: "https://smba.trafficmanager.net/emea/",
      trigger_mode: "always",
      enabled: true,
    })
    expect(cfg.conversation_ids).toEqual(["19:abc123@thread.tacv2"])
    expect(cfg.service_url).toBe("https://smba.trafficmanager.net/emea/")
    expect(cfg.trigger_mode).toBe("always")
    expect(cfg.enabled).toBe(true)
    expect(Teams.get(pid)).toMatchObject({ conversation_ids: ["19:abc123@thread.tacv2"] })
  })

  test("upsert applies defaults for trigger_mode and enabled", async () => {
    const pid = await seed()
    const cfg = Teams.upsert(pid, Teams.UpsertInput.parse({
      conversation_ids: ["c1"],
      service_url: "https://smba.trafficmanager.net/emea/",
    }))
    expect(cfg.trigger_mode).toBe("always")
    expect(cfg.enabled).toBe(true)
  })

  test("upsert overwrites existing config", async () => {
    const pid = await seed()
    Teams.upsert(pid, {
      conversation_ids: ["old"],
      service_url: "https://smba.trafficmanager.net/emea/",
      trigger_mode: "always",
      enabled: true,
    })
    Teams.upsert(pid, {
      conversation_ids: ["new"],
      service_url: "https://smba.trafficmanager.net/apac/",
      trigger_mode: "mention",
      enabled: false,
    })
    expect(Teams.get(pid)?.conversation_ids).toEqual(["new"])
    expect(Teams.get(pid)?.trigger_mode).toBe("mention")
    expect(Teams.get(pid)?.enabled).toBe(false)
  })

  test("remove deletes config", async () => {
    const pid = await seed()
    Teams.upsert(pid, {
      conversation_ids: ["c1"],
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
    Teams.upsert(p1, { conversation_ids: ["c1"], service_url: "https://x/", trigger_mode: "always", enabled: true })
    Teams.upsert(p2, { conversation_ids: ["c2"], service_url: "https://x/", trigger_mode: "always", enabled: false })
    Teams.upsert(p3, { conversation_ids: ["c3"], service_url: "https://x/", trigger_mode: "always", enabled: true })
    const dirs = Teams.listDirs()
    expect(dirs.sort()).toEqual(["/tmp/a", "/tmp/c"])
  })

  test("lookup resolves conversation ID to project + worktree", async () => {
    const pid = await seed("proj-1", "/tmp/work")
    Teams.upsert(pid, {
      conversation_ids: ["19:xyz@thread.tacv2"],
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
      conversation_ids: ["c1"],
      service_url: "https://x/",
      trigger_mode: "always",
      enabled: false,
    })
    expect(Teams.lookup("c1")).toEqual({ project_id: pid, worktree: "/tmp/work" })
  })

  test("upsert persists multiple conversation IDs and lookup finds each", async () => {
    const pid = await seed("proj-1", "/tmp/multi")
    Teams.upsert(pid, {
      conversation_ids: ["c-a", "c-b", "c-c"],
      service_url: "https://x/",
      trigger_mode: "always",
      enabled: true,
    })
    expect(Teams.get(pid)?.conversation_ids.sort()).toEqual(["c-a", "c-b", "c-c"])
    expect(Teams.lookup("c-a")).toEqual({ project_id: pid, worktree: "/tmp/multi" })
    expect(Teams.lookup("c-b")).toEqual({ project_id: pid, worktree: "/tmp/multi" })
    expect(Teams.lookup("c-c")).toEqual({ project_id: pid, worktree: "/tmp/multi" })
  })

  test("re-upsert with smaller list removes dropped IDs", async () => {
    const pid = await seed("proj-1", "/tmp/shrink")
    Teams.upsert(pid, {
      conversation_ids: ["keep", "drop"],
      service_url: "https://x/",
      trigger_mode: "always",
      enabled: true,
    })
    Teams.upsert(pid, {
      conversation_ids: ["keep"],
      service_url: "https://x/",
      trigger_mode: "always",
      enabled: true,
    })
    expect(Teams.get(pid)?.conversation_ids).toEqual(["keep"])
    expect(Teams.lookup("drop")).toBeNull()
    expect(Teams.lookup("keep")).toEqual({ project_id: pid, worktree: "/tmp/shrink" })
  })

  test("upserting an ID owned by another project throws ConflictError", async () => {
    const a = await seed("proj-a", "/tmp/a")
    const b = await seed("proj-b", "/tmp/b")
    Teams.upsert(a, {
      conversation_ids: ["shared"],
      service_url: "https://x/",
      trigger_mode: "always",
      enabled: true,
    })
    expect(() =>
      Teams.upsert(b, {
        conversation_ids: ["shared"],
        service_url: "https://x/",
        trigger_mode: "always",
        enabled: true,
      }),
    ).toThrow(Teams.ConflictError)
  })

  test("UpsertInput rejects empty conversation_ids array", () => {
    expect(() =>
      Teams.UpsertInput.parse({
        conversation_ids: [],
        service_url: "https://x/",
      }),
    ).toThrow()
  })

  test("UpsertInput rejects whitespace-only IDs", () => {
    expect(() =>
      Teams.UpsertInput.parse({
        conversation_ids: ["   "],
        service_url: "https://x/",
      }),
    ).toThrow()
  })

  test("Teams.remove cascades to teams_conversation", async () => {
    const pid = await seed("proj-1", "/tmp/cascade")
    Teams.upsert(pid, {
      conversation_ids: ["a", "b"],
      service_url: "https://x/",
      trigger_mode: "always",
      enabled: true,
    })
    Teams.remove(pid)
    expect(Teams.lookup("a")).toBeNull()
    expect(Teams.lookup("b")).toBeNull()
  })
})
