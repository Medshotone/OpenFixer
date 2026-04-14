import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useMutation, useQuery } from "@tanstack/solid-query"
import { createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useAgentConfigOptions } from "@/hooks/use-agent-config-options"
import { AgentConfigPanel, agentConfigLabels, type AgentConfigValue } from "./agent-config-panel"

export function DialogProjectSettings(props: { project: LocalProject }) {
  const dialog = useDialog()
  const sdk = useGlobalSDK()
  const lang = useLanguage()

  const [value, setValue] = createStore<AgentConfigValue>({
    agent: null,
    model: null,
    variant: null,
    auto_accept: false,
  })

  const query = useQuery(() => ({
    queryKey: ["project-agent", props.project.worktree],
    queryFn: async () => {
      const r = await sdk.client.projectAgent.get({ directory: props.project.worktree })
      return r.data ?? null
    },
  }))

  createEffect(() => {
    const cfg = query.data
    if (!cfg) return
    setValue({ agent: cfg.agent, model: cfg.model, variant: cfg.variant, auto_accept: cfg.auto_accept })
  })

  const { agents, variants } = useAgentConfigOptions(
    () => props.project.worktree,
    () => value.model,
  )

  const save = useMutation(() => ({
    mutationFn: async () => {
      await sdk.client.projectAgent.upsert({
        directory: props.project.worktree,
        agent: value.agent,
        model: value.model,
        variant: value.variant,
        auto_accept: !!value.auto_accept,
      })
      dialog.close()
    },
  }))

  return (
    <Dialog title={lang.t("dialog.project.settings.title")} class="w-full max-w-[480px] mx-auto">
      <div class="flex flex-col gap-6 p-6 pt-0">
        <AgentConfigPanel
          mode="default"
          value={value}
          onChange={(next) =>
            setValue({
              agent: next.agent,
              model: next.model,
              variant: next.variant,
              auto_accept: next.auto_accept ?? false,
            })
          }
          agents={agents()}
          variants={variants()}
          labels={agentConfigLabels(lang.t)}
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {lang.t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" size="large" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? lang.t("common.saving") : lang.t("common.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
