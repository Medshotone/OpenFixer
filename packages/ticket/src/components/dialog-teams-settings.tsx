import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { useMutation } from "@tanstack/solid-query"
import { createEffect, For, createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useAgentConfigOptions } from "@/hooks/use-agent-config-options"
import { AgentConfigPanel, agentConfigLabels, type AgentConfigInherited } from "./agent-config-panel"

export function DialogTeamsSettings(props: { project: LocalProject }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()

  const [store, setStore] = createStore({
    conversation_ids: [""] as string[],
    service_url: "",
    tenant_id: "",
    trigger_mode: "always" as "always" | "mention",
    enabled: true,
    agent: null as string | null,
    model: null as string | null,
    variant: null as string | null,
    auto_accept: null as boolean | null,
    inherited: null as AgentConfigInherited | null,
  })
  const [error, setError] = createSignal<string | null>(null)

  const { agents, variants } = useAgentConfigOptions(
    () => props.project.worktree,
    () => store.model,
  )

  createEffect(async () => {
    const cfg = await globalSDK.client.teams.get({ directory: props.project.worktree })
    if (cfg.data) {
      const ids = cfg.data.conversation_ids ?? []
      setStore("conversation_ids", ids.length ? ids : [""])
      setStore("service_url", cfg.data.service_url ?? "")
      setStore("tenant_id", cfg.data.tenant_id ?? "")
      setStore("trigger_mode", cfg.data.trigger_mode ?? "always")
      setStore("enabled", cfg.data.enabled ?? true)
      setStore("agent", cfg.data.agent ?? null)
      setStore("model", cfg.data.model ?? null)
      setStore("variant", cfg.data.variant ?? null)
      setStore("auto_accept", cfg.data.auto_accept ?? null)
    }
    const pa = await globalSDK.client.projectAgent.get({ directory: props.project.worktree })
    setStore("inherited", pa.data ?? { agent: null, model: null, variant: null, auto_accept: false })
  })

  function setId(i: number, v: string) {
    setStore("conversation_ids", produce((arr) => { arr[i] = v }))
  }

  function addId() {
    setStore("conversation_ids", produce((arr) => { arr.push("") }))
  }

  function removeId(i: number) {
    setStore(
      "conversation_ids",
      produce((arr) => {
        if (arr.length === 1) arr[0] = ""
        else arr.splice(i, 1)
      }),
    )
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async () => {
      const ids = Array.from(
        new Set(store.conversation_ids.map((s) => s.trim()).filter((s) => s.length > 0)),
      )
      if (ids.length === 0) {
        setError(language.t("dialog.teams.conversation_ids.required"))
        return
      }
      setError(null)
      try {
        await globalSDK.client.teams.upsert({
          directory: props.project.worktree,
          conversation_ids: ids,
          service_url: store.service_url.trim(),
          tenant_id: store.tenant_id.trim() || null,
          trigger_mode: store.trigger_mode,
          enabled: store.enabled,
          agent: store.agent,
          model: store.model,
          variant: store.variant,
          auto_accept: store.auto_accept,
        })
        dialog.close()
      } catch (err) {
        const msg =
          (err as { error?: string })?.error ??
          (err as Error)?.message ??
          "Failed to save"
        setError(msg)
      }
    },
  }))

  function submit(e: SubmitEvent) {
    e.preventDefault()
    if (saveMutation.isPending) return
    saveMutation.mutate()
  }

  return (
    <Dialog title={language.t("dialog.teams.title")} class="w-full max-w-[480px] mx-auto">
      <form onSubmit={submit} class="flex flex-col gap-6 p-6 pt-0 overflow-y-auto">
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-2">
            <span class="text-14-regular text-text-base">
              {language.t("dialog.teams.conversation_ids")}
            </span>
            <For each={store.conversation_ids}>
              {(id, i) => (
                <div class="flex items-center gap-2">
                  <div class="flex-1">
                    <TextField
                      autofocus={i() === 0}
                      placeholder={language.t("dialog.teams.conversation_ids.placeholder")}
                      value={id}
                      onChange={(v) => setId(i(), v)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="small"
                    title={language.t("dialog.teams.conversation_ids.remove")}
                    onClick={() => removeId(i())}
                  >
                    ×
                  </Button>
                </div>
              )}
            </For>
            <Button type="button" variant="ghost" size="small" onClick={addId}>
              {language.t("dialog.teams.conversation_ids.add")}
            </Button>
            {error() && <span class="text-14-regular text-text-danger">{error()}</span>}
          </div>
          <TextField
            type="url"
            label={language.t("dialog.teams.service_url")}
            placeholder={language.t("dialog.teams.service_url.placeholder")}
            value={store.service_url}
            onChange={(v) => setStore("service_url", v)}
          />
          <TextField
            label={language.t("dialog.teams.tenant_id")}
            placeholder={language.t("dialog.teams.tenant_id.placeholder")}
            value={store.tenant_id}
            onChange={(v) => setStore("tenant_id", v)}
          />
          <label class="flex flex-col gap-1.5 text-14-regular text-text-base">
            {language.t("dialog.teams.trigger_mode")}
            <select
              value={store.trigger_mode}
              onChange={(e) => setStore("trigger_mode", e.currentTarget.value as "always" | "mention")}
              class="bg-background-subtle border border-border-base rounded-md px-3 py-2 text-14-regular"
            >
              <option value="always">{language.t("dialog.teams.trigger_mode.always")}</option>
              <option value="mention">{language.t("dialog.teams.trigger_mode.mention")}</option>
            </select>
          </label>
          <label class="flex items-center gap-2 text-14-regular text-text-base cursor-pointer">
            <input
              type="checkbox"
              checked={store.enabled}
              onChange={(e) => setStore("enabled", e.currentTarget.checked)}
              class="size-4"
            />
            {language.t("dialog.teams.enabled")}
          </label>
        </div>
        <AgentConfigPanel
          mode="override"
          value={{ agent: store.agent, model: store.model, variant: store.variant, auto_accept: store.auto_accept }}
          onChange={(v) => {
            setStore("agent", v.agent)
            setStore("model", v.model)
            setStore("variant", v.variant)
            setStore("auto_accept", v.auto_accept)
          }}
          agents={agents()}
          variants={variants()}
          inherited={store.inherited ?? undefined}
          labels={agentConfigLabels(language.t)}
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
