---
name: telegram-claude-bridge
description: Telegram bot connected to Claude Code for mobile messaging
metadata:
  node_type: memory
  type: reference
---

## Telegram-Claude Code Bridge

Telegram bot @JinzongAssistantBot connects to Claude Code.

### How it works

- Uses Monitor to poll Telegram API every 2 seconds
- Forwards new messages to Claude Code for processing
- Replies via Telegram sendMessage API

### User info

- chat_id: 8582340013
- Username: jack jin

### Auth env vars (for launchd)

- `ANTHROPIC_AUTH_TOKEN`: via .env
- `ANTHROPIC_BASE_URL`: https://api.deepseek.com/anthropic
- `ANTHROPIC_MODEL`: deepseek-chat
