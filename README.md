# Claude Code 配置集

本地 Claude Code 的配置、Telegram 桥接脚本和记忆文件管理。

## 目录结构

```
claude-config/
├── CLAUDE.md              # 全局 CLAUDE 指令
├── telegram-bridge/
│   ├── bridge.js          # Telegram ↔ Claude Code 桥接脚本
│   └── launchd.plist      # macOS launchd 配置
├── claude/
│   └── settings.json      # Claude Code 全局设置
├── openclaw/
│   └── openclaw.json      # OpenClaw 网关配置
├── claude-web/
│   ├── server.js          # Web 聊天面板服务端
│   ├── index.html         # 聊天 UI (模仿 claude.ai)
│   ├── package.json       # Node.js 依赖
│   └── launchd.plist      # macOS 自启配置
├── memory/
│   └── telegram-bridge.md # 桥接记忆文件
└── .env.example           # 环境变量模板
```

## 使用方式

1. 复制 `.env.example` 为 `.env`，填入实际 token
2. Telegram 桥接: `node telegram-bridge/bridge.js`
3. launchd 自启: 将 `telegram-bridge/launchd.plist` 复制到 `~/Library/LaunchAgents/` 并 `launchctl load`
