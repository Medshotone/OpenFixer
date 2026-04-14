import { createMemo, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Select } from "@opencode-ai/ui/select"
import { ModelSelectorPopover } from "./dialog-select-model"
import { useSettingsModelState } from "@/hooks/use-settings-model-state"

export function agentConfigLabels(t: (k: string) => string) {
  return {
    agent: t("common.agent"),
    model: t("common.model"),
    variant: t("common.variant"),
    autoAccept: t("common.autoaccept"),
    inherit: t("common.inherit"),
    defaultVariant: t("common.default"),
    enabled: t("common.enabled"),
    disabled: t("common.disabled"),
    none: t("common.none"),
    chooseModel: t("dialog.model.select.title"),
  }
}

export type AgentConfigValue = {
  agent: string | null
  model: string | null
  variant: string | null
  auto_accept: boolean | null
}

export type AgentConfigInherited = {
  agent: string | null
  model: string | null
  variant: string | null
  auto_accept: boolean
}

type Props = {
  mode: "default" | "override"
  value: AgentConfigValue
  onChange: (next: AgentConfigValue) => void
  agents: string[]
  variants: string[]
  inherited?: AgentConfigInherited
  labels: {
    agent: string
    model: string
    variant: string
    autoAccept: string
    inherit: string
    defaultVariant: string
    enabled: string
    disabled: string
    none: string
    chooseModel: string
  }
}

const INHERIT = "__inherit__"
const DEFAULT_VARIANT = "__default__"

export function AgentConfigPanel(props: Props) {
  const override = () => props.mode === "override"

  const agentOptions = createMemo(() => (override() ? [INHERIT, ...props.agents] : props.agents))
  const variantOptions = createMemo(() =>
    override() ? [INHERIT, DEFAULT_VARIANT, ...props.variants] : [DEFAULT_VARIANT, ...props.variants],
  )

  const agentLabel = (name: string) => {
    if (name === INHERIT) return `${props.labels.inherit}: ${props.inherited?.agent ?? props.labels.none}`
    return name
  }
  const variantLabel = (name: string) => {
    if (name === INHERIT) {
      return `${props.labels.inherit}: ${props.inherited?.variant ?? props.labels.defaultVariant}`
    }
    if (name === DEFAULT_VARIANT) return props.labels.defaultVariant
    return name
  }

  const agentCurrent = () => (props.value.agent === null && override() ? INHERIT : props.value.agent ?? "")
  const variantCurrent = () => {
    if (props.value.variant === null) return override() ? INHERIT : DEFAULT_VARIANT
    return props.value.variant
  }

  const pickAgent = (val: string | undefined) => {
    if (val === INHERIT || val === undefined) return props.onChange({ ...props.value, agent: null })
    props.onChange({ ...props.value, agent: val })
  }
  const pickVariant = (val: string | undefined) => {
    if (val === INHERIT || val === DEFAULT_VARIANT || val === undefined)
      return props.onChange({ ...props.value, variant: null })
    props.onChange({ ...props.value, variant: val })
  }

  const model = useSettingsModelState(
    () => props.value.model,
    (next) => props.onChange({ ...props.value, model: next }),
  )

  const modelInherited = () => override() && props.value.model === null
  const modelDisplay = () => {
    if (modelInherited()) {
      return `${props.labels.inherit}: ${props.inherited?.model ?? props.labels.none}`
    }
    return model.current()?.name ?? props.labels.chooseModel
  }

  const cycleAccept = () => {
    const cur = props.value.auto_accept
    if (!override()) return props.onChange({ ...props.value, auto_accept: !cur })
    const next = cur === null ? true : cur ? false : null
    props.onChange({ ...props.value, auto_accept: next })
  }
  const acceptAria = () => {
    if (props.value.auto_accept === null && override()) {
      return `${props.labels.autoAccept} — ${props.labels.inherit}: ${props.inherited?.auto_accept ? props.labels.enabled : props.labels.disabled}`
    }
    return `${props.labels.autoAccept} — ${props.value.auto_accept ? props.labels.enabled : props.labels.disabled}`
  }
  const accepting = () => props.value.auto_accept === true
  const acceptInherited = () => override() && props.value.auto_accept === null

  return (
    <div class="flex items-center gap-1.5 min-w-0">
      <Select
        size="normal"
        options={agentOptions()}
        current={agentCurrent()}
        label={agentLabel}
        onSelect={pickAgent}
        class="capitalize max-w-[160px] text-text-base"
        valueClass="truncate text-13-regular text-text-base"
        triggerProps={{ "data-action": "prompt-agent", title: props.labels.agent }}
        variant="ghost"
      />
      <ModelSelectorPopover
        model={model}
        triggerAs={Button}
        triggerProps={{
          variant: "ghost",
          size: "normal",
          class: "min-w-0 max-w-[320px] text-13-regular text-text-base group",
          "data-action": "prompt-model",
          title: props.labels.model,
        }}
      >
        <Show when={model.current()?.provider?.id && !modelInherited()}>
          <ProviderIcon
            id={model.current()?.provider?.id ?? ""}
            class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
          />
        </Show>
        <span class="truncate" classList={{ "opacity-60": modelInherited() }}>
          {modelDisplay()}
        </span>
        <Icon name="chevron-down" size="small" class="shrink-0" />
      </ModelSelectorPopover>
      <Show when={override() && props.value.model !== null}>
        <IconButton
          icon="close"
          variant="ghost"
          size="normal"
          class="size-6"
          aria-label={props.labels.inherit}
          title={props.labels.inherit}
          onClick={() => props.onChange({ ...props.value, model: null })}
        />
      </Show>
      <Select
        size="normal"
        options={variantOptions()}
        current={variantCurrent()}
        label={variantLabel}
        onSelect={pickVariant}
        class="capitalize max-w-[160px] text-text-base"
        valueClass="truncate text-13-regular text-text-base"
        triggerProps={{ "data-action": "prompt-model-variant", title: props.labels.variant }}
        variant="ghost"
      />
      <Button
        type="button"
        data-action="prompt-permissions"
        variant="ghost"
        size="normal"
        onClick={cycleAccept}
        classList={{
          "h-7 w-7 p-0 shrink-0 flex items-center justify-center": true,
          "text-text-base": !accepting() && !acceptInherited(),
          "opacity-40": acceptInherited(),
          "hover:bg-surface-success-base": accepting(),
        }}
        aria-label={acceptAria()}
        aria-pressed={!!props.value.auto_accept}
        title={acceptAria()}
      >
        <Icon name="shield" size="small" classList={{ "text-icon-success-base": accepting() }} />
      </Button>
    </div>
  )
}
