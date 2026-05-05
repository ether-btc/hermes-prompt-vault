# hermes-prompt-vault

Hermes plugin for saving, organizing, and reusing prompts via `/vault` slash commands.

## Features

- **/vault save** — Save prompts with title, content, and optional description
- **/vault search** — Search prompts by title, content, or description
- **/vault use** — Show a prompt's full content for copying
- **/vault list** — List recent prompts with optional category filter
- **/vault favorite** — Toggle favorite status by prompt ID
- **/vault delete** — Delete a prompt
- **/vault stats** — Show vault statistics
- **Dashboard UI** — Full web dashboard for managing prompts

## Installation

```bash
hermes plugins install github:leven/hermes-prompt-vault
```

## Usage

```
/vault help
/vault save My Prompt | The prompt content here | Optional description
/vault search code review
/vault favorite abc12345
```

## License

MIT
