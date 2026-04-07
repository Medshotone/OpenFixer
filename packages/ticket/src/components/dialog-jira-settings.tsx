import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { useMutation } from "@tanstack/solid-query"
import { createEffect, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"

export function DialogJiraSettings(props: { project: LocalProject }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()

  const [store, setStore] = createStore({
    url: "",
    email: "",
    token: "",
    project_key: "",
    interval: 30,
    enabled: true,
    showToken: false,
    result: null as boolean | null,
    testing: false,
  })

  createEffect(async () => {
    const [cfg, tok] = await Promise.all([
      globalSDK.client.jira.get({ directory: props.project.worktree }),
      globalSDK.client.jira.token({ directory: props.project.worktree }),
    ])
    if (cfg.data) {
      setStore("url", cfg.data.url ?? "")
      setStore("email", cfg.data.email ?? "")
      setStore("project_key", cfg.data.project_key ?? "")
      setStore("interval", cfg.data.interval ?? 30)
      setStore("enabled", cfg.data.enabled ?? true)
    }
    if (tok.data) setStore("token", tok.data)
  })

  const saveMutation = useMutation(() => ({
    mutationFn: async () => {
      await globalSDK.client.jira.upsert({
        directory: props.project.worktree,
        url: store.url.trim(),
        email: store.email.trim(),
        token: store.token.trim(),
        project_key: store.project_key.trim().toUpperCase(),
        interval: store.interval,
        enabled: store.enabled,
      })
      dialog.close()
    },
  }))

  async function test() {
    setStore("testing", true)
    setStore("result", null)
    const res = await globalSDK.client.jira.test({
      directory: props.project.worktree,
      url: store.url.trim(),
      email: store.email.trim(),
      token: store.token.trim(),
      project_key: store.project_key.trim().toUpperCase(),
    })
    setStore("result", !res.error && res.data?.ok === true)
    setStore("testing", false)
  }

  function submit(e: SubmitEvent) {
    e.preventDefault()
    if (saveMutation.isPending) return
    saveMutation.mutate()
  }

  return (
    <Dialog title={language.t("dialog.jira.title")} class="w-full max-w-[480px] mx-auto">
      <form onSubmit={submit} class="flex flex-col gap-6 p-6 pt-0 overflow-y-auto">
        <div class="flex flex-col gap-4">
          <TextField
            autofocus
            type="url"
            label={language.t("dialog.jira.url")}
            placeholder={language.t("dialog.jira.url.placeholder")}
            value={store.url}
            onChange={(v) => setStore("url", v)}
          />
          <TextField
            type="email"
            label={language.t("dialog.jira.email")}
            placeholder={language.t("dialog.jira.email.placeholder")}
            value={store.email}
            onChange={(v) => setStore("email", v)}
          />
          <div class="flex flex-col gap-1.5">
            <div class="flex items-end gap-2">
              <div class="flex-1">
                <TextField
                  type={store.showToken ? "text" : "password"}
                  label={language.t("dialog.jira.token")}
                  placeholder={language.t("dialog.jira.token.placeholder")}
                  value={store.token}
                  onChange={(v) => setStore("token", v)}
                />
              </div>
              <IconButton
                type="button"
                icon="eye"
                variant={store.showToken ? "primary" : "ghost"}
                aria-label={store.showToken ? "Hide token" : "Show token"}
                onClick={() => setStore("showToken", !store.showToken)}
              />
            </div>
          </div>
          <TextField
            label={language.t("dialog.jira.projectKey")}
            placeholder={language.t("dialog.jira.projectKey.placeholder")}
            value={store.project_key}
            onChange={(v) => setStore("project_key", v)}
          />
          <TextField
            type="number"
            label={language.t("dialog.jira.interval")}
            value={String(store.interval)}
            onChange={(v) => setStore("interval", Number(v))}
          />
          <label class="flex items-center gap-2 text-14-regular text-text-base cursor-pointer">
            <input
              type="checkbox"
              checked={store.enabled}
              onChange={(e) => setStore("enabled", e.currentTarget.checked)}
              class="size-4"
            />
            {language.t("dialog.jira.enabled")}
          </label>
          <div class="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="normal"
              disabled={store.testing || !store.url || !store.email || !store.token || !store.project_key}
              onClick={test}
            >
              {store.testing ? "Testing..." : language.t("dialog.jira.test")}
            </Button>
            <Show when={store.result !== null}>
              <span
                class="text-13-regular"
                classList={{
                  "text-text-success-base": store.result === true,
                  "text-text-critical-base": store.result === false,
                }}
              >
                {store.result ? language.t("dialog.jira.test.success") : language.t("dialog.jira.test.failed")}
              </span>
            </Show>
          </div>
        </div>
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
