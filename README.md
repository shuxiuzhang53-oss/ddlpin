# ddlpin — 你的本地任务中枢 + 桌面便签

> **DDL**(deadline)+ **pin**(钉在桌面):在任意 AI 里顺口记任务,桌面便签常驻倒计时,到点把你拽回来。

在任何 AI(Claude Code / Codex / mirasim 会话)里顺口说一句就记下,桌面便签常驻显示 + 到点升级式提醒。
**daemon 与 MCP 零第三方依赖**(Node ≥22.5 内置 sqlite),数据全在本地 `~/.taskboard/`。

> 平台:目前一键安装脚本面向 **macOS**(launchd 自启)。Electron 便签本身跨平台,Windows/Linux 的自启装法在路线图上(欢迎 PR)。

设计文档见 [DESIGN.md](DESIGN.md)。

## 组成

| 组件 | 作用 | 运行方式 |
|---|---|---|
| `src/daemon/` | 真相源:SQLite + HTTP API + 提醒调度 + ntfy 推送 | launchd 常驻(`com.taskboard.daemon`) |
| `src/mcp/` | MCP server(零依赖 stdio),把 AI 的工具调用转发给 daemon | 由 CC/Codex/mirasim 各自 spawn |
| `sticky/` | Electron 桌面便签:置顶、倒计时、配色、勾选/贪睡/添加 | launchd 常驻(`com.taskboard.sticky`) |

## 安装(一次)

```bash
cd sticky && npm install && cd ..          # 装 electron
bash scripts/install-daemon.sh             # 装并启动 daemon + 便签(launchd,开机自启)
```

> Electron 二进制若因公司 npm 策略没自动下载:`unzip -oq ~/Library/Caches/electron/electron-*.zip -d sticky/node_modules/electron/dist && printf 'Electron.app/Contents/MacOS/Electron' > sticky/node_modules/electron/path.txt`

## 接入三个 AI 入口

**Claude Code**(user 级,在仓库根目录执行):
```bash
claude mcp add taskboard --scope user -- node "$(pwd)/src/mcp/server.js"
```
> 注意:新加的 MCP 要**重启 Claude Code** 才在会话里生效。

**Codex**:在 `~/.codex/config.toml` 加(把路径换成本仓库的绝对路径):
```toml
[mcp_servers.taskboard]
command = "node"
args = ["/absolute/path/to/taskboard/src/mcp/server.js"]
```

**mirasim**:把上面这个 MCP 注册为 mirasim 的全局 MCP 扩展即可(mirasim 的会话本身就是 CC/Codex,自动就带上工具)。

## 怎么用

在任意 AI 对话里自然说:
- “把『周五下午5点前交季度报告』记到看板,高优先级”
- “看板上今天有什么要做的?”
- “把交报告那个改到下周一”
- “那个任务完成了”

AI 会调用 `add_task / list_tasks / update_task / complete_task / snooze_task / drop_task`,并把解析出的**绝对截止时间**复述给你确认。

便签上也能直接:输入框敲一行回车加任务、悬停勾 ✓ 完成、💤 贪睡 1 小时、`▁` 切换迷你胸章形态。

## 配手机推送(安卓 · ntfy)

1. 手机装 **ntfy** App(Play Store / F-Droid)。
2. 编辑 `~/.taskboard/config.json` 的 `ntfy.topic` 为一个**只有你知道的随机串**(如 `taskboard-a7f3k9`)。
3. App 里订阅同名 topic。
4. 重启 daemon:`launchctl kickstart -k gui/$(id -u)/com.taskboard.daemon`

之后到点/逾期提醒会推到手机。(通知里的“完成/改期”动作按钮需要 daemon 可被手机访问,属后续项。)

## 便签不见了怎么办

便签常驻在菜单栏(📌 图标),几种召回方式:
- **全局快捷键 `⌘⇧D`** —— 最快,任何时候召回并置顶。
- **点菜单栏 📌 图标** —— 单击切换显示/隐藏;右键菜单有「归位到主屏右上角」。
- 点便签右上角 **✕ 是隐藏**(不是退出),随时能召回;真正退出在 📌 右键菜单里。

设计上的可靠性:
- 便签**崩溃会被 launchd 自动拉起**;只有你从 📌 菜单主动「退出」才真正停。
- **多屏/换显示器**导致窗口跑到屏幕外时,召回会**自动把它夹回**当前屏幕。
- 看板为空时窗口会缩成一张小卡片(「清空啦 🎉」),属正常。

## 数据 & 运维

- 数据:`~/.taskboard/tasks.db`(真相源)+ `board.md`(人类可读镜像,可 git)
- 日志:`~/.taskboard/daemon.log` / `sticky.log`
- 配置:`~/.taskboard/config.json`(端口、默认截止时刻、催促间隔、晨报时间、ntfy)
- 重启:`launchctl kickstart -k gui/$(id -u)/com.taskboard.{daemon,sticky}`
- 卸载:`launchctl unload ~/Library/LaunchAgents/com.taskboard.{daemon,sticky}.plist`
