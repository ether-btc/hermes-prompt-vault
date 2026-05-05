# Prompt Vault for Hermes Agent

A prompt library plugin for [Hermes Agent](https://github.com/NousResearch/hermes-agent). Save, organize, version, and reuse prompts from the dashboard or any platform via slash commands.

## Features

- **Web Dashboard** — Visual prompt library with search, categories, tags, favorites, version history
- **Slash Commands** — Access your prompts from CLI, Telegram, Discord, Slack via `/vault`
- **Import/Export** — Share prompt collections as JSON files
- **Version History** — Auto-saves previous versions when you edit
- **Themeable** — Adapts to your dashboard theme

## Install

```bash
hermes plugins install LeventeNagy/hermes-prompt-vault
hermes plugins enable prompt-vault
```

Then restart Hermes (`/reset` or restart the gateway).

## Slash Commands

```
/vault list [category]       List prompts
/vault search <query>        Search prompts
/vault use <id>              Show full prompt content
/vault save Title | content  Save a new prompt
/vault delete <id>           Delete a prompt
/vault stats                 Show vault stats
```

## Dashboard

Start the dashboard to use the visual interface:

```bash
hermes dashboard
```

Click the **Prompt Vault** tab in the nav bar.

## Manual Install

```bash
cd ~/.hermes/plugins
git clone https://github.com/LeventeNagy/hermes-prompt-vault.git
hermes plugins enable prompt-vault
```

## License

MIT
