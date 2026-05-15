# CLAUDE.md — qclaw Home Workspace

## Language

- Primary language: 中文 (Chinese). Respond in Chinese unless asked otherwise.
- Code comments and variable names: English.

## Claude Code Version

- Version: 2.1.x (installed globally via npm)
- Model: deepseek-chat (custom API)
- Memory system: `/Users/qclaw/.claude/projects/-Users-qclaw/memory/`
- Settings: `/Users/qclaw/.claude/settings.json` (global), `settings.local.json` (user)

## Projects

### Local
- `openclaw/` — Multi-channel AI messaging platform
  - Repo: https://github.com/openclaw/openclaw
  - Guidelines in `openclaw/CLAUDE.md`
  - TypeScript/Node.js, pnpm workspace, Telegram/Discord/Slack/WhatsApp
- `dexter/` — Autonomous financial research agent by virattt
  - Repo: https://github.com/virattt/dexter
  - Bun runtime, multi-LLM provider (OpenAI/Anthropic/DeepSeek)
  - Finance tools, DCF valuation, X research skills
- `Applications/ComfyUI/` — Stable Diffusion UI (Python)

### External Platforms
- Feishu (Lark) bot app: `cli_aa8ee2a6b139dcc5`
- Hermes skills: `.hermes/skills/` (devops, cron, health checks)

## Preferences

- Communication: concise, direct. Avoid emojis.
- Prefer terminal/Bash workflows over GUI.
- Use `find`, `grep`, and CLI tools for code searches.
- Tool calls in English, conversation in Chinese.

## Permissions

Current allowlist (settings.local.json):
- `Bash(*)` — All shell commands allowed
- `Read(//private/tmp/**)`, `Read(//tmp/**)` — Temp file reads
- `WebSearch` — Web search
- `WebFetch(domain:open.feishu.cn)` — Feishu API access
