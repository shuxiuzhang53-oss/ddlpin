#!/usr/bin/env bash
# 安装 taskd 为 macOS LaunchAgent(开机自启 + 崩溃自动拉起)。
set -euo pipefail

NODE_BIN="$(command -v node)"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MAIN="$REPO_DIR/src/daemon/main.js"
PLIST="$HOME/Library/LaunchAgents/com.taskboard.daemon.plist"
LABEL="com.taskboard.daemon"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.taskboard"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$MAIN</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.taskboard/daemon.log</string>
  <key>StandardErrorPath</key><string>$HOME/.taskboard/daemon.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
EOF

echo "写入 $PLIST"
# 重新加载
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
sleep 1
echo "已加载。状态:"
launchctl list | grep taskboard || echo "(未在 launchctl list 中,查看 ~/.taskboard/daemon.log)"
echo "健康检查:"
curl -s http://127.0.0.1:4747/health && echo || echo "(daemon 尚未就绪,稍等 1-2 秒再试)"

# ---------- 便签(Electron)LaunchAgent ----------
# 直接用原生 Electron 二进制(不经过 .bin/electron 的 node shebang,避免 launchd PATH 里没 node)
ELECTRON_BIN="$REPO_DIR/sticky/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
STICKY_DIR="$REPO_DIR/sticky"
SPLIST="$HOME/Library/LaunchAgents/com.taskboard.sticky.plist"
SLABEL="com.taskboard.sticky"

if [ -x "$ELECTRON_BIN" ]; then
  cat > "$SPLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$SLABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$ELECTRON_BIN</string>
    <string>$STICKY_DIR</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$HOME/.taskboard/sticky.log</string>
  <key>StandardErrorPath</key><string>$HOME/.taskboard/sticky.log</string>
</dict>
</plist>
EOF
  echo "写入 $SPLIST"
  launchctl unload "$SPLIST" 2>/dev/null || true
  launchctl load "$SPLIST"
  echo "便签已启动(如未见窗口,查看 ~/.taskboard/sticky.log)"
else
  echo "跳过便签:未找到 electron,请先在 sticky/ 里 npm install"
fi

echo ""
echo "✅ 安装完成。数据与日志在 ~/.taskboard/"
echo "   卸载:launchctl unload ~/Library/LaunchAgents/com.taskboard.{daemon,sticky}.plist"
