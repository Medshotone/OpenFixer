import { afterEach, describe, expect, test } from "bun:test"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { Jira } from "../../src/jira/index"

Log.init({ print: false })

afterEach(async () => {
  await resetDatabase()
})

describe("Jira CRUD", () => {
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

  test("upsert stores config and get retrieves it", async () => {
    const pid = await seed()
    const cfg = Jira.upsert(pid, {
      url: "https://example.atlassian.net",
      email: "user@example.com",
      token: "secret",
      project_key: "AILA",
      interval: 30,
      enabled: true,
    })
    expect(cfg.url).toBe("https://example.atlassian.net")
    expect(cfg.project_key).toBe("AILA")
    expect(Jira.get(pid)).toMatchObject({ project_key: "AILA" })
  })

  test("upsert overwrites existing config", async () => {
    const pid = await seed()
    Jira.upsert(pid, { url: "https://a.atlassian.net", email: "a@a.com", token: "t1", project_key: "OLD", interval: 30, enabled: true })
    Jira.upsert(pid, { url: "https://b.atlassian.net", email: "b@b.com", token: "t2", project_key: "NEW", interval: 60, enabled: false })
    expect(Jira.get(pid)?.project_key).toBe("NEW")
    expect(Jira.get(pid)?.enabled).toBe(false)
  })

  test("remove deletes config", async () => {
    const pid = await seed()
    Jira.upsert(pid, { url: "https://x.atlassian.net", email: "x@x.com", token: "t", project_key: "X", interval: 30, enabled: true })
    Jira.remove(pid)
    expect(Jira.get(pid)).toBeUndefined()
  })

  test("get returns undefined for missing config", async () => {
    const pid = await seed()
    expect(Jira.get(pid)).toBeUndefined()
  })
})
