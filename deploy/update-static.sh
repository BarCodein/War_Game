#!/usr/bin/env bash
set -euo pipefail
# ─────────────────────────────────────────────────────────────────────────────
# War of Dots · 静态站更新（幂等 / 可从"仓库损坏"状态自愈）
#
# 为什么不用 git pull：
#   · 部署目录里出现本地改动（手动热修、.bak 备份）时 pull 会直接失败；
#   · 目录被 git init 成空仓库（No commits yet）时 pull 根本没有可合并的历史；
#   · 远端分支名与本地不一致（main vs master）时 pull 也会报错。
# 这里统一改成 fetch + reset --hard + clean，只信任"远端部署仓库的内容"。
#
# 用法：
#   sudo ./deploy/update-static.sh                    # 同步
#   sudo ./deploy/update-static.sh --dry-run          # 只显示会删掉哪些文件，不动手
#   sudo REMOTE_URL=https://x-access-token:<TOKEN>@github.com/BarCodein/war_game_deploy_repo.git \
#        ./deploy/update-static.sh                     # 首次/换远端时指定仓库地址
#
# 环境变量：
#   STATIC_DIR  默认 /var/www/html/war_game/repo
#   BRANCH      默认 main（CI 推的就是 main）
#   RUN_USER    默认 www-data（git 命令以该用户执行，避免 root 拥有 .git）
#   KEEP_GLOB   clean 时保留的本地文件，默认 '*.bak-*'（你的临时备份）
# ─────────────────────────────────────────────────────────────────────────────
STATIC_DIR="${STATIC_DIR:-/var/www/html/war_game/repo}"
BRANCH="${BRANCH:-main}"
RUN_USER="${RUN_USER:-www-data}"
REMOTE_URL="${REMOTE_URL:-}"
KEEP_GLOB="${KEEP_GLOB:-*.bak-*}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

say() { printf '\n==> %s\n' "$*"; }
as_user() { if [[ "$(id -u)" -eq 0 ]]; then sudo -u "$RUN_USER" "$@"; else "$@"; fi; }

say "静态站目录：$STATIC_DIR（分支 $BRANCH，用户 $RUN_USER）"
[[ -d "$STATIC_DIR" ]] || { echo "目录不存在：$STATIC_DIR"; exit 1; }
cd "$STATIC_DIR"

# ---------- 1) 仓库自检 / 自愈 ----------
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "（dry-run）当前没有 .git，正式执行会 git init -b $BRANCH"
  else
    say "没有 .git：初始化为 $BRANCH"
    as_user git init -b "$BRANCH"
  fi
fi

if [[ -n "$REMOTE_URL" ]]; then
  if git remote get-url origin >/dev/null 2>&1; then
    [[ "$DRY_RUN" == "1" ]] || as_user git remote set-url origin "$REMOTE_URL"
  else
    [[ "$DRY_RUN" == "1" ]] || as_user git remote add origin "$REMOTE_URL"
  fi
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  cat <<'EOF'
错误：这个目录没有配置 origin 远程仓库。
请用环境变量指定（私有仓库需要 token 或 Deploy Key）：
  sudo REMOTE_URL=https://x-access-token:<TOKEN>@github.com/BarCodein/war_game_deploy_repo.git \
       ./deploy/update-static.sh
EOF
  exit 1
fi
echo "    origin = $(git remote get-url origin | sed -E 's#(https://)[^@]*@#\1***@#')"

# 分支名兼容：远端没有 main 时回退 master
REMOTE_BRANCH="$BRANCH"
if ! as_user git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  for candidate in master main; do
    if as_user git ls-remote --exit-code --heads origin "$candidate" >/dev/null 2>&1; then
      REMOTE_BRANCH="$candidate"
      break
    fi
  done
fi
echo "    远端分支 = origin/$REMOTE_BRANCH"

# ---------- 2) 先看会丢掉什么 ----------
say "将要删除的未跟踪文件（保留 $KEEP_GLOB）"
as_user git fetch --prune --depth 1 origin "$REMOTE_BRANCH"
as_user git reset --mixed --quiet "origin/$REMOTE_BRANCH" 2>/dev/null || true
as_user git clean -ndx -e "$KEEP_GLOB" || true

if [[ "$DRY_RUN" == "1" ]]; then
  echo
  echo "（dry-run 结束：没有改动任何文件）"
  exit 0
fi

# ---------- 3) 同步到远端内容 ----------
say "丢弃本地改动并同步到 origin/$REMOTE_BRANCH"
as_user git reset --hard "origin/$REMOTE_BRANCH"
as_user git clean -fdx -e "$KEEP_GLOB"

# ---------- 4) 校验 ----------
say "校验"
as_user git log --oneline -1
for file in index.html game.html pvp.html pvp-battle.html members/member.html climb/climb.html; do
  [[ -f "$file" ]] && echo "    ✓ $file" || echo "    ✗ 缺少 $file"
done
curl -fsS -o /dev/null -w '    首页 HTTP %{http_code}\n' http://127.0.0.1/ || echo "    首页检查失败（Nginx 在跑吗？）"

say "完成"
echo "源仓库（Node 服务）的更新请用 deploy/update.sh；两者互不影响。"
