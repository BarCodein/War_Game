#!/usr/bin/env bash
set -euo pipefail
# ─────────────────────────────────────────────────────────────────────────────
# War of Dots · PvP 服务端更新脚本（在服务器上手动执行）
#
# 用法：
#   sudo ./deploy/update.sh              # 拉代码 + 装依赖 + 重启 + 健康检查
#   sudo ./deploy/update.sh --check-only # 只做健康检查
#
# 前提（见 docs/pvp-deploy.md）：
#   · 代码在 /opt/war-game-server（主仓，用 Deploy Key 只读拉取）
#   · systemd 单元 war-game.service 已安装
#   · 静态产物由 CI 构建后发布到 /var/www/html/war_game/repo，本脚本不碰它
# ─────────────────────────────────────────────────────────────────────────────
APP_DIR="${APP_DIR:-/opt/war-game-server}"
SERVICE="${SERVICE:-war-game}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
RUN_USER="${RUN_USER:-wargame}"

say() { printf '\n==> %s\n' "$*"; }

health() {
  say "健康检查 $HEALTH_URL"
  local body
  body="$(curl -fsS --max-time 5 "$HEALTH_URL")" || { echo "健康检查失败：服务没有响应"; return 1; }
  echo "$body"
  # Node 环境里解析 JSON，避免依赖 jq
  echo "$body" | node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      const data = JSON.parse(raw);
      const sim = data.sim ?? {};
      console.log(`  版本 ${data.version} · Node ${data.node} · 房间 ${data.rooms} · 对局 ${data.matches}`
        + ` · tick 平均 ${sim.tickMsAvg ?? "-"} ms / 最大 ${sim.tickMsMax ?? "-"} ms`);
      if (!data.ok) process.exit(1);
    });
  '
}

if [[ "${1:-}" == "--check-only" ]]; then
  health
  exit 0
fi

say "拉取代码（跳过 LFS 大文件）"
cd "$APP_DIR"
sudo -u "$RUN_USER" env GIT_LFS_SKIP_SMUDGE=1 git pull --ff-only

say "安装运行时依赖"
sudo -u "$RUN_USER" npm ci --omit=dev

say "重启服务"
systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" || { echo "服务未启动，查看：journalctl -u $SERVICE -n 50"; exit 1; }

health

say "最近日志"
journalctl -u "$SERVICE" -n 15 --no-pager || true

echo
echo "完成。前端页面由 CI 构建产物发布，若本次含前端改动请确认 /var/www/html/war_game/repo 已更新。"
