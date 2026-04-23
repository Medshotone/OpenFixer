# @opencode-ai/teams

Microsoft Teams bot for OpenFixer. Bridges Teams conversations to the opencode agent — each user message starts a fresh session in the project bound to that conversation.

## Architecture

- **Per-project binding.** One OpenFixer project ↔ one Teams conversation (channel thread, 1:1 DM, or group chat). Bind in the project's Teams Settings dialog in the UI.
- **Push model.** Teams calls `POST /api/messages`; the bot looks up the project by `conversation.id`, forks a fresh opencode session, and streams tool progress back into the same thread.
- **Unbound conversations** receive a discovery message with the conversation ID so the user can paste it into project settings.

## Setup

### 1. Create the Azure Bot + app manifest

1. Create an **Azure Bot** resource (F0 / free SKU) in the Azure portal.
2. Note the auto-generated `MICROSOFT_APP_ID` and create a client secret for `MICROSOFT_APP_PASSWORD`.
3. Under the bot's *Channels* blade, add **Microsoft Teams**.
4. Set the bot's *messaging endpoint* to `https://<your-public-https-host>/api/messages`.
5. Create a Teams app manifest referencing the same App ID, zip with two icons, upload to Teams via *Apps → Manage your apps → Upload a custom app*.

### 2. Point a Teams conversation at a project

In the OpenFixer ticket UI, right-click a project → **Teams Settings**. You need two values:

- `Conversation ID` — message the bot from the target Teams conversation. It will reply with *"I'm not linked yet. Paste this ID into the project settings: `<id>`"*. Copy and paste.
- `Service URL` — pasted from the same discovery message (shown below the conversation ID).

Save the dialog. The next message in that conversation is routed to this project.

### 3. Run the bot

```bash
cp .env.example .env
# fill MICROSOFT_APP_ID, MICROSOFT_APP_PASSWORD, OPENCODE_SERVER_URL, optionally PORT
bun install
bun dev
```

The bot listens on `PORT` (default `3978`) at `/api/messages`. Expose over HTTPS via Microsoft Dev Tunnels, ngrok, or a production reverse proxy, and point the Azure Bot's messaging endpoint at that URL.

## Settings

Per-project config is stored server-side in `teams_config` (keyed by `project_id`), edited via the UI dialog. Fields:

- `conversation_id` — Bot Framework conversation identifier
- `service_url` — needed to post tool-update messages proactively
- `tenant_id` — optional, for single-tenant bots
- `trigger_mode` — `"always"` (default, reply to every message) or `"mention"` (only `@bot`)
- `enabled` — master toggle
- `agent` / `model` / `variant` / `auto_accept` — per-project overrides merged against the project's default `AgentConfig`

## Session lifetime

Each incoming message creates a fresh opencode session. No thread-level session reuse. This matches the "one session per answer" semantic — if you want continuity across messages, that's a future enhancement.
