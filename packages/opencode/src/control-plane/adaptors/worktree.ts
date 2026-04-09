import z from "zod"
import { Worktree } from "@/worktree"
import { type Adaptor, WorkspaceInfo } from "../types"

const Config = WorkspaceInfo.extend({
  name: WorkspaceInfo.shape.name.unwrap(),
  branch: WorkspaceInfo.shape.branch.unwrap(),
  directory: WorkspaceInfo.shape.directory.unwrap(),
})

type Config = z.infer<typeof Config>

export const WorktreeAdaptor: Adaptor = {
  async configure(info) {
    const extra = info.extra as { name?: string; branch?: string; source?: string } | null
    const worktree = await Worktree.makeWorktreeInfo(extra?.name ?? info.name ?? undefined)
    return {
      ...info,
      name: worktree.name,
      branch: extra?.branch ?? worktree.branch,
      directory: worktree.directory,
    }
  },
  async create(info) {
    const config = Config.parse(info)
    const source = (config.extra as { source?: string } | null)?.source
    await Worktree.createFromInfo({
      name: config.name,
      directory: config.directory,
      branch: config.branch,
    }, undefined, source)
  },
  async remove(info) {
    const config = Config.parse(info)
    await Worktree.remove({ directory: config.directory })
  },
  async fetch(_info, _input: RequestInfo | URL, _init?: RequestInit) {
    throw new Error("fetch not implemented")
  },
}
