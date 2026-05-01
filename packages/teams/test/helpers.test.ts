import { describe, expect, test } from "bun:test"
import { parsePromptCommand, withFooter, buildCard, buildPicker } from "../src/index"

describe("parsePromptCommand", () => {
  test("returns 'id' for /id with leading/trailing whitespace", () => {
    expect(parsePromptCommand("  /id  ")).toBe("id")
  })

  test("returns 'project' for /project (case-insensitive)", () => {
    expect(parsePromptCommand("/PROJECT")).toBe("project")
  })

  test("returns null for unknown commands and plain text", () => {
    expect(parsePromptCommand("hello world")).toBeNull()
    expect(parsePromptCommand("/unknown")).toBeNull()
    expect(parsePromptCommand("/id please")).toBeNull()
  })

  test("returns null for empty string", () => {
    expect(parsePromptCommand("")).toBeNull()
  })
})

describe("withFooter", () => {
  test("appends italic markdown footer", () => {
    expect(withFooter("hello", "Funda")).toBe("hello\n\n_Project: Funda_")
  })

  test("works with empty body", () => {
    expect(withFooter("", "X")).toBe("\n\n_Project: X_")
  })
})

describe("buildCard", () => {
  test("includes Project footer when projectName provided", () => {
    const card = buildCard({ phase: "done", steps: [], projectName: "Funda" })
    const json = JSON.stringify(card)
    expect(json).toContain("Project: Funda")
    expect(json).toContain("isSubtle")
  })

  test("omits Project footer when projectName empty", () => {
    const card = buildCard({ phase: "working", steps: [], projectName: "" })
    const json = JSON.stringify(card)
    expect(json).not.toContain("Project:")
  })

  test("backwards-compatible call without projectName omits footer", () => {
    const card = buildCard({ phase: "done", steps: [] })
    expect(JSON.stringify(card)).not.toContain("Project:")
  })
})

describe("buildPicker", () => {
  const projects = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      project_id: `p${i + 1}`,
      name: `Project ${i + 1}`,
      worktree: `/tmp/p${i + 1}`,
    }))

  test("buttons mode for ≤4 projects", () => {
    const card = buildPicker(projects(3))
    const json = JSON.stringify(card)
    expect(json).toContain("\"Action.Submit\"")
    expect(json).toContain("\"Project 1\"")
    expect(json).toContain("\"switchProject\"")
    expect(json).not.toContain("Input.ChoiceSet")
  })

  test("dropdown mode for >4 projects", () => {
    const card = buildPicker(projects(5))
    const json = JSON.stringify(card)
    expect(json).toContain("Input.ChoiceSet")
    expect(json).toContain("\"Use\"")
  })

  test("checkmark on currently active project (buttons mode)", () => {
    const card = buildPicker(projects(2), "p2")
    const json = JSON.stringify(card)
    expect(json).toMatch(/Project 2\s+✓/)
  })

  test("dropdown mode pre-selects current value", () => {
    const card = buildPicker(projects(5), "p3")
    const json = JSON.stringify(card)
    expect(json).toContain("\"value\":\"p3\"")
  })
})
