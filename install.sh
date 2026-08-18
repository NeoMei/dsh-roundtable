#!/usr/bin/env bash
#
# install.sh — 一键安装 dsh-roundtable 到 DSH profile。
#
# 默认：从 npm 安装三个 @neomei/dsh-* 包 + 从 GitHub Release 下载 skill，
# 然后幂等写入 cordis.patch.yml 并复制 skill。无需本地构建。

set -euo pipefail

RT_REPO="${RT_REPO:-NeoMei/dsh-roundtable}"
RT_VERSION="${RT_VERSION:-0.1.0-rc.6}"
PROFILE="${DSH_PROFILE:-$HOME/.dsh/profiles/desktop}"

TGZ_DIR=""
SKILL=""
TARBALLS=()
DRY_RUN=0

usage() {
  cat <<'EOF'
一键安装 dsh-roundtable 到 DSH profile。

默认: 从 npm 安装三个 @neomei/dsh-* 包 + 下载 skill（无需本地构建）。

用法:
  ./install.sh                        # 从 npm 安装并下载 skill
  ./install.sh --version 0.1.0-rc.6   # 指定版本
  ./install.sh --profile DIR          # 指定 profile（默认 ~/.dsh/profiles/desktop）
  ./install.sh --tgz-dir DIR          # 离线：用本地 tarball，不装 npm
  ./install.sh a.tgz b.tgz c.tgz      # 离线：直接给三个 tarball（任意顺序）
  ./install.sh --skill FILE           # 用本地 SKILL.md（默认从 release 下载）
  ./install.sh --dry-run              # 只预演，不执行
  -h, --help                          # 本帮助
EOF
}

# ---- 参数解析 ----
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --version) RT_VERSION="$2"; shift 2 ;;
    --repo) RT_REPO="$2"; shift 2 ;;
    --tgz-dir) TGZ_DIR="$2"; shift 2 ;;
    --skill) SKILL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "未知选项: $1" >&2; usage >&2; exit 2 ;;
    *) TARBALLS+=("$1"); shift ;;
  esac
done

command -v pnpm >/dev/null 2>&1 || { echo "未找到 pnpm（DSH Desktop 的 PATH 自带；请确认已安装）" >&2; exit 1; }

# ---- skill：离线 or 下载 ----
if [[ -z "$SKILL" ]]; then
  if [[ ${#TARBALLS[@]} -gt 0 || -n "$TGZ_DIR" ]]; then
    SKILL="./skill/SKILL.md"
  else
    command -v curl >/dev/null 2>&1 || { echo "未找到 curl（下载 skill 需要）" >&2; exit 1; }
    DL_DIR="$(mktemp -d)"
    trap 'rm -rf "$DL_DIR"' EXIT
    SKILL_URL="https://github.com/${RT_REPO}/releases/download/v${RT_VERSION}/SKILL.md"
    echo "下载 $SKILL_URL"
    curl -fL --retry 3 -o "$DL_DIR/SKILL.md" "$SKILL_URL" || { echo "下载失败: $SKILL_URL" >&2; exit 1; }
    SKILL="$DL_DIR/SKILL.md"
  fi
fi
[[ -f "$SKILL" ]] || { echo "skill 文件不存在: $SKILL" >&2; exit 1; }

if [[ ${#TARBALLS[@]} -gt 0 || -n "$TGZ_DIR" ]]; then MODE="离线 tarball"; else MODE="npm"; fi
echo "profile : $PROFILE"
echo "版本     : $RT_VERSION"
echo "安装方式 : $MODE"
echo "skill   : $SKILL"

if [[ "$DRY_RUN" == 1 ]]; then
  echo
  echo "[dry-run] 将执行: 安装 3 个包 → 幂等写入 cordis.patch.yml → 复制 skill"
  exit 0
fi

mkdir -p "$PROFILE"

# ---- 1. 安装三个包 ----
if [[ ${#TARBALLS[@]} -gt 0 ]]; then
  (
    cd "$PROFILE"
    pnpm add "${TARBALLS[@]}"
  )
elif [[ -n "$TGZ_DIR" ]]; then
  [[ -d "$TGZ_DIR" ]] || { echo "目录不存在: $TGZ_DIR" >&2; exit 1; }
  pick() {
    local matches=( "$TGZ_DIR"/"$1"-*.tgz )
    [[ ${#matches[@]} -gt 0 && -f "${matches[0]}" ]] || { echo "未找到 $1-*.tgz（目录: $TGZ_DIR）" >&2; exit 1; }
    echo "${matches[0]}"
  }
  (
    cd "$PROFILE"
    pnpm add "$(pick neomei-dsh-roundtable)" "$(pick neomei-dsh-tool-roundtable)" "$(pick neomei-dsh-client-ui-roundtable)"
  )
else
  (
    cd "$PROFILE"
    pnpm add \
      "@neomei/dsh-roundtable@${RT_VERSION}" \
      "@neomei/dsh-tool-roundtable@${RT_VERSION}" \
      "@neomei/dsh-client-ui-roundtable@${RT_VERSION}"
  )
fi

# ---- 2. 幂等写入 cordis.patch.yml ----
PATCH_FILE="$PROFILE/cordis.patch.yml"
PATCH_BLOCK=$(cat <<'EOF'

# Roundtable: 多智能体圆桌讨论（out-of-tree 插件）。
- insert:
    - id: roundtable
      name: '@neomei/dsh-roundtable'
      config:
        provider: spawn

    - id: tool-roundtable
      name: '@neomei/dsh-tool-roundtable'

    - id: ui-roundtable
      name: '@neomei/dsh-client-ui-roundtable'
EOF
)

if [[ -f "$PATCH_FILE" ]] && grep -q '@neomei/dsh-roundtable' "$PATCH_FILE"; then
  echo "cordis.patch.yml 已包含 roundtable 插件，跳过补丁。"
else
  if [[ ! -f "$PATCH_FILE" ]]; then
    printf '# 本 profile 的 patch 层：顶层 YAML 数组，每项是 loader patch entry。\n' > "$PATCH_FILE"
  fi
  printf '%s\n' "$PATCH_BLOCK" >> "$PATCH_FILE"
  echo "已写入 $PATCH_FILE"
fi

# ---- 3. 复制 skill ----
mkdir -p "$HOME/.agents/skills/roundtable"
cp "$SKILL" "$HOME/.agents/skills/roundtable/SKILL.md"
echo "已复制 skill → $HOME/.agents/skills/roundtable/SKILL.md"

echo
echo "✅ 安装完成。请完全重启 DSH Desktop 以加载宿主插件。"
