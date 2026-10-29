#!/usr/bin/env bash
set -euo pipefail
# ─────────────────────────────────────────────────────────────────────────────
# War of Dots · 静态站更新（幂等 / 可从"空仓库、无远程、认证失败"状态自愈）
#
# 为什么不用 git pull：
#   · 部署目录里出现本地改动时会失败；
#   · 目录被 git init 成空仓库（No commits yet）时没有可合并历史；
#   · 本地分支名（master）与远端（main）不一致时会失败；
#   · 私有部署仓库匿名拉取会要求账号密码 —— 而 GitHub 早已不支持密码认证。
# 这里统一改成：自检/修复仓库 → 校验凭据 → fetch + reset --hard + clean。
#
# 用法：
#   ./deploy/update-static.sh                 # 同步（自动探测目录与分支）
#   ./deploy/update-static.sh --dry-run       # 只显示会删掉哪些文件
#   REMOTE_URL=https://x-access-token:<TOKEN>@github.com/BarCodein/war_game_deploy_repo.git \
#     ./deploy/update-static.sh               # 首次 / 换远程 / 用 token
#
# 环境变量：
#   STATIC_DIR  部署目录（默认自动探测 ~/server/web/dist 或 /var/www/html/war_game/repo）
#   BRANCH      优先分支，默认 main（远端没有就自动回退 master）
#   RUN_USER    执行 git 的用户（默认当前用户）
#   KEEP_GLOB   clean 时保留的本地文件，默认 '*.bak-*'
# ─────────────────────────────────────────────────────────────────────────────
BRANCH_PREF="${BRANCH:-main}"
RUN_USER="${RUN_USER:-$(id -un)}"
REMOTE_URL="${REMOTE_URL:-}"
KEEP_GLOB="${KEEP_GLOB:-*.bak-*}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

say() { printf '\n==> %s\n' "$*"; }
as_user() { if [[ "$(id -u)" -eq 0 && "$RUN_USER" != "root" ]]; then sudo -u "$RUN_USER" "$@"; else "$@"; fi; }
mask() { sed -E 's#(https://)[^@/]*@#\1***@#'; }

# ---------- 0) 探测目录 ----------
if [[ -z "${STATIC_DIR:-}" ]]; then
  for candidate in "$HOME/server/web/dist" /var/www/html/war_game/repo; do
    if [[ -d "$candidate" ]]; then STATIC_DIR="$candidate"; break; fi
  done
fi
[[ -n "${STATIC_DIR:-}" && -d "$STATIC_DIR" ]] || {
  echo "找不到静态站目录，请显式指定：STATIC_DIR=/path/to/dist $0"; exit 1; }
cd "$STATIC_DIR"

say "静态站目录：$STATIC_DIR"
echo "    执行用户 = $RUN_USER · 优先分支 = $BRANCH_PREF · 保留 = $KEEP_GLOB"

# ---------- 1) 仓库自检 / 自愈 ----------
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "    （dry-run）当前没有 .git，正式执行会 git init -b $BRANCH_PREF"
  else
    say "没有 .git：初始化为 $BRANCH_PREF"
    as_user git init -b "$BRANCH_PREF"
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

私有仓库需要凭据（GitHub 不支持账号密码）。三选一：
  ① 公开部署仓库（最简单）：GitHub → 仓库 Settings → 最下方 Change visibility → Public，
     然后：REMOTE_URL=https://github.com/BarCodein/war_game_deploy_repo.git ./deploy/update-static.sh
  ② 只读 Deploy Key（推荐，长期有效）：
       ssh-keygen -t ed25519 -C "war-game-deploy" -f ~/.ssh/war_game_deploy -N ''
       把 ~/.ssh/war_game_deploy.pub 加到 部署仓库 → Settings → Deploy keys（不要勾 Write access）
       cat >> ~/.ssh/config <<'EOC'
       Host gh-war-deploy
         HostName github.com
         User git
         IdentityFile ~/.ssh/war_game_deploy
         IdentitiesOnly yes
       EOC
       chmod 600 ~/.ssh/config
       REMOTE_URL=git@gh-war-deploy:BarCodein/war_game_deploy_repo.git ./deploy/update-static.sh
  ③ 细粒度 PAT（Contents: Read）：把它拼进 URL
       REMOTE_URL=https://x-access-token:<TOKEN>@github.com/BarCodein/war_game_deploy_repo.git \
         ./deploy/update-static.sh
EOF
  exit 1
fi
echo "    origin = $(git remote get-url origin | mask)"

# ---------- 2) 凭据 / 分支预检 ----------
say "检查远程可访问性与分支"
if ! as_user git ls-remote --exit-code --heads origin >/dev/null 2>&1; then
  cat <<'EOF'

错误：无法访问远程仓库（认证失败或网络不通）。
  · 报 "Invalid username or token" / "Authentication failed" → 仓库是私有的，且当前 URL 没带有效凭据，
    按上面 ① / ② / ③ 任选一种方式配好再跑。
  · 报 "Could not resolve host" → 检查 DNS/出网。
EOF
  exit 1
fi

REMOTE_BRANCH="$BRANCH_PREF"
if ! as_user git ls-remote --exit-code --heads origin "$REMOTE_BRANCH" >/dev/null 2>&1; then
  for candidate in main master; do
    if as_user git ls-remote --exit-code --heads origin "$candidate" >/dev/null 2>&1; then
      REMOTE_BRANCH="$candidate"; break
    fi
  done
fi
echo "    远端分支 = origin/$REMOTE_BRANCH"

# ---------- 3) 预览将删除的未跟踪文件 ----------
as_user git fetch --prune --depth 1 origin "$REMOTE_BRANCH"
as_user git reset --mixed --quiet "origin/$REMOTE_BRANCH" 2>/dev/null || true

say "未跟踪文件（执行时会删除，保留 $KEEP_GLOB）"
as_user git clean -ndx -e "$KEEP_GLOB" || true

if [[ "$DRY_RUN" == "1" ]]; then
  echo
  echo "（dry-run 结束：没有改动任何文件）"
  exit 0
fi

# ---------- 4) 同步 ----------
say "丢弃本地改动并同步到 origin/$REMOTE_BRANCH"
as_user git reset --hard "origin/$REMOTE_BRANCH"
as_user git clean -fdx -e "$KEEP_GLOB"

# ---------- 5) 校验 ----------
say "校验"
as_user git log --oneline -1
for file in index.html game.html pvp.html pvp-battle.html members/member.html climb/climb.html; do
  [[ -f "$file" ]] && echo "    ✓ $file" || echo "    ✗ 缺少 $file"
done
curl -fsS -o /dev/null -w '    首页 HTTP %{http_code}\n' http://127.0.0.1/ || echo "    首页检查失败（Nginx 在跑吗？）"

say "完成"
echo "源仓库（Node 服务）的更新请用 deploy/update.sh；两者互不影响。"
