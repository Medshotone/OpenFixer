import { createMemo, type Accessor } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useProviders } from "@/hooks/use-providers"

export function useAgentConfigOptions(worktree: () => string, model: Accessor<string | null>) {
  const sync = useGlobalSync()
  const providers = useProviders()

  const agents = createMemo(() => {
    const [store] = sync.child(worktree())
    return store.agent.filter((x) => x.mode !== "subagent" && !x.hidden).map((x) => x.name)
  })

  const variants = createMemo(() => {
    const m = model()
    if (!m) return []
    const slash = m.indexOf("/")
    if (slash === -1) return []
    const pid = m.slice(0, slash)
    const mid = m.slice(slash + 1)
    const provider = providers.all().find((p) => p.id === pid)
    if (!provider) return []
    const data = (provider.models as Record<string, { variants?: Record<string, unknown> }>)[mid]
    if (!data?.variants) return []
    return Object.keys(data.variants)
  })

  return { agents, variants }
}
