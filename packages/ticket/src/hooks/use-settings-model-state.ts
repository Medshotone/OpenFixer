import { useModels } from "@/context/models"
import type { useLocal } from "@/context/local"

type ModelState = ReturnType<typeof useLocal>["model"]

export function useSettingsModelState(get: () => string | null, set: (next: string | null) => void): ModelState {
  const models = useModels()

  const parse = () => {
    const v = get()
    if (!v) return null
    const slash = v.indexOf("/")
    if (slash === -1) return null
    return { providerID: v.slice(0, slash), modelID: v.slice(slash + 1) }
  }

  const shim = {
    list: models.list,
    visible: () => true,
    setVisibility: () => undefined,
    current() {
      const key = parse()
      if (!key) return undefined
      return models.find(key)
    },
    set(item: { providerID: string; modelID: string } | undefined) {
      set(item ? `${item.providerID}/${item.modelID}` : null)
    },
  }
  return shim as unknown as ModelState
}
