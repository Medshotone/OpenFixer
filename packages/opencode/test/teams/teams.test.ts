import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
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

  test("upsert stores and returns dm_user_ids", async () => {
    const pid = await seed()
    const cfg = Teams.upsert(pid, {
      conversation_ids: ["c1"],
      service_url: "https://x/",
      trigger_mode: "always",
      enabled: true,
      dm_user_ids: ["aad-1", "aad-2"],
    })
    expect(cfg.dm_user_ids.sort()).toEqual(["aad-1", "aad-2"])
    expect(Teams.get(pid)?.dm_user_ids.sort()).toEqual(["aad-1", "aad-2"])
  })

  test("upsert defaults dm_user_ids to empty array", async () => {
    const pid = await seed()
    const cfg = Teams.upsert(pid, Teams.UpsertInput.parse({
      conversation_ids: ["c1"],
      service_url: "https://x/",
    }))
    expect(cfg.dm_user_ids).toEqual([])
  })

  test("upsert replaces dm_user_ids on rewrite", async () => {
    const pid = await seed()
    Teams.upsert(pid, {
      conversation_ids: ["c1"],
      service_url: "https://x/",
      trigger_mode: "always",
      enabled: true,
      dm_user_ids: ["aad-1", "aad-2"],
    })
    Teams.upsert(pid, {
      conversation_ids: ["c1"],
      service_url: "https://x/",
      trigger_mode: "always",
      enabled: true,
      dm_user_ids: ["aad-3"],
    })
    expect(Teams.get(pid)?.dm_user_ids.sort()).toEqual(["aad-3"])
  })

  test("upsert with empty dm_user_ids clears existing entries", async () => {
    const pid = await seed()
    Teams.upsert(pid, {
      conversation_ids: ["c1"],
      service_url: "https://x/",
      trigger_mode: "always",
      enabled: true,
      dm_user_ids: ["aad-1"],
    })
    Teams.upsert(pid, {
      conversation_ids: ["c1"],
      service_url: "https://x/",
      trigger_mode: "always",
      enabled: true,
      dm_user_ids: [],
    })
    expect(Teams.get(pid)?.dm_user_ids).toEqual([])
  })
})

describe("Teams DM allowlist queries", () => {
  test("listForUser returns enabled allowlisted projects only", async () => {
    const p1 = await seed("p1", "/tmp/p1")
    const p2 = await seed("p2", "/tmp/p2")
    const p3 = await seed("p3", "/tmp/p3")
    Teams.upsert(p1, {
      conversation_ids: ["c1"], service_url: "https://x/",
      trigger_mode: "always", enabled: true, dm_user_ids: ["aad-1"],
    })
    Teams.upsert(p2, {
      conversation_ids: ["c2"], service_url: "https://x/",
      trigger_mode: "always", enabled: false, dm_user_ids: ["aad-1"],
    })
    Teams.upsert(p3, {
      conversation_ids: ["c3"], service_url: "https://x/",
      trigger_mode: "always", enabled: true, dm_user_ids: ["aad-other"],
    })
    const list = Teams.listForUser("aad-1")
    expect(list.map((p) => p.project_id).sort()).toEqual([p1])
    expect(list[0].worktree).toBe("/tmp/p1")
    expect(typeof list[0].name).toBe("string")
  })

  test("listForUser returns empty for unknown user", async () => {
    await seed()
    expect(Teams.listForUser("nobody")).toEqual([])
  })

  test("listForUser falls back to worktree basename when name is null", async () => {
    const pid = await seed("p-null", "/var/www/work/fundaactive")
    Teams.upsert(pid, {
      conversation_ids: ["c1"], service_url: "https://x/",
      trigger_mode: "always", enabled: true, dm_user_ids: ["aad-1"],
    })
    expect(Teams.listForUser("aad-1")[0].name).toBe("fundaactive")
  })

  test("listForUser falls back to worktree basename when name is empty string", async () => {
    const pid = await seed("p-empty", "/var/www/work/fundaactive")
    Database.use((db) =>
      db.update(ProjectTable).set({ name: "" }).where(eq(ProjectTable.id, pid)).run(),
    )
    Teams.upsert(pid, {
      conversation_ids: ["c1"], service_url: "https://x/",
      trigger_mode: "always", enabled: true, dm_user_ids: ["aad-1"],
    })
    expect(Teams.listForUser("aad-1")[0].name).toBe("fundaactive")
  })

  test("listForUser uses real name when set", async () => {
    const pid = await seed("p-named", "/var/www/work/fundaactive")
    Database.use((db) =>
      db.update(ProjectTable).set({ name: "Funda Production" }).where(eq(ProjectTable.id, pid)).run(),
    )
    Teams.upsert(pid, {
      conversation_ids: ["c1"], service_url: "https://x/",
      trigger_mode: "always", enabled: true, dm_user_ids: ["aad-1"],
    })
    expect(Teams.listForUser("aad-1")[0].name).toBe("Funda Production")
  })

  test("hasAccess true for allowlisted user on enabled project", async () => {
    const pid = await seed()
    Teams.upsert(pid, {
      conversation_ids: ["c1"], service_url: "https://x/",
      trigger_mode: "always", enabled: true, dm_user_ids: ["aad-1"],
    })
    expect(Teams.hasAccess("aad-1", pid)).toBe(true)
  })

  test("hasAccess false for non-allowlisted user", async () => {
    const pid = await seed()
    Teams.upsert(pid, {
      conversation_ids: ["c1"], service_url: "https://x/",
      trigger_mode: "always", enabled: true, dm_user_ids: ["aad-1"],
    })
    expect(Teams.hasAccess("aad-other", pid)).toBe(false)
  })

  test("hasAccess false when project disabled", async () => {
    const pid = await seed()
    Teams.upsert(pid, {
      conversation_ids: ["c1"], service_url: "https://x/",
      trigger_mode: "always", enabled: false, dm_user_ids: ["aad-1"],
    })
    expect(Teams.hasAccess("aad-1", pid)).toBe(false)
  })

  test("hasAccess false when project has no Teams config", async () => {
    const pid = await seed()
    expect(Teams.hasAccess("aad-anything", pid)).toBe(false)
  })
})

describe("Teams reply project_id", () => {
  test("recordReply round-trips project_id", async () => {
    const pid = await seed()
    Teams.recordReply({ message_id: "m1", session_id: "s1", worktree: "/tmp/test", project_id: pid })
    const hit = Teams.lookupReply("m1")
    expect(hit?.session_id).toBe("s1")
    expect(hit?.worktree).toBe("/tmp/test")
    expect(hit?.project_id).toBe(pid)
  })

  test("recordReply without project_id stores null", async () => {
    Teams.recordReply({ message_id: "m1", session_id: "s1", worktree: "/tmp/test" })
    const hit = Teams.lookupReply("m1")
    expect(hit?.project_id ?? null).toBeNull()
  })
})

describe("Teams DM state", () => {
  test("dmGet returns null for unknown conversation", async () => {
    expect(Teams.dmGet("19:nosuch")).toBeNull()
  })

  test("dmGet falls back to worktree basename for null and empty-string names", async () => {
    const pid = await seed("p-funda", "/var/www/work/fundaactive")
    Database.use((db) =>
      db.update(ProjectTable).set({ name: "" }).where(eq(ProjectTable.id, pid)).run(),
    )
    Teams.upsert(pid, {
      conversation_ids: ["c1"], service_url: "https://x/",
      trigger_mode: "always", enabled: true, dm_user_ids: ["aad-1"],
    })
    Teams.dmSet("19:dm", pid, "aad-1")
    expect(Teams.dmGet("19:dm")?.name).toBe("fundaactive")
  })

  test("dmSet stores selection when user has access", async () => {
    const pid = await seed()
    Teams.upsert(pid, {
      conversation_ids: ["c1"], service_url: "https://x/",
      trigger_mode: "always", enabled: true, dm_user_ids: ["aad-1"],
    })
    const state = Teams.dmSet("19:dm", pid, "aad-1")
    expect(state.conversation_id).toBe("19:dm")
    expect(state.project_id).toBe(pid)
    expect(typeof state.name).toBe("string")
    expect(Teams.dmGet("19:dm")?.project_id).toBe(pid)
  })

  test("dmSet throws AccessError when user not allowlisted", async () => {
    const pid = await seed()
    Teams.upsert(pid, {
      conversation_ids: ["c1"], service_url: "https://x/",
      trigger_mode: "always", enabled: true, dm_user_ids: ["aad-1"],
    })
    expect(() => Teams.dmSet("19:dm", pid, "aad-other")).toThrow(Teams.AccessError)
    expect(Teams.dmGet("19:dm")).toBeNull()
  })

  test("dmSet upsert overwrites previous selection in same conversation", async () => {
    const p1 = await seed("p1", "/tmp/p1")
    const p2 = await seed("p2", "/tmp/p2")
    Teams.upsert(p1, {
      conversation_ids: ["c1"], service_url: "https://x/",
      trigger_mode: "always", enabled: true, dm_user_ids: ["aad-1"],
    })
    Teams.upsert(p2, {
      conversation_ids: ["c2"], service_url: "https://x/",
      trigger_mode: "always", enabled: true, dm_user_ids: ["aad-1"],
    })
    Teams.dmSet("19:dm", p1, "aad-1")
    Teams.dmSet("19:dm", p2, "aad-1")
    expect(Teams.dmGet("19:dm")?.project_id).toBe(p2)
  })

  test("dm_state survives admin revocation (lazy invalidation)", async () => {
    const pid = await seed()
    Teams.upsert(pid, {
      conversation_ids: ["c1"], service_url: "https://x/",
      trigger_mode: "always", enabled: true, dm_user_ids: ["aad-1"],
    })
    Teams.dmSet("19:dm", pid, "aad-1")
    Teams.upsert(pid, {
      conversation_ids: ["c1"], service_url: "https://x/",
      trigger_mode: "always", enabled: true, dm_user_ids: [],
    })
    expect(Teams.dmGet("19:dm")?.project_id).toBe(pid)
    expect(Teams.hasAccess("aad-1", pid)).toBe(false)
  })
})
