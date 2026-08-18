#!/usr/bin/env bash
#
# install.sh — 一键安装 dsh-roundtable 到 DSH profile。
#
# 默认：从 GitHub Release 下载预构建的 tarball 与 skill（无需本地构建），
# 然后：复制 tarball 到 profile → pnpm add → 幂等写入 cordis.patch.yml → 复制 skill。
# 离线：用 --tgz-dir 或位置参数给本地 tarball，用 --skill 给本地 SKILL.md。

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

默认: 从 GitHub Release 下载预构建 tarball + skill 并安装（无需本地构建）。

用法:
  ./install.sh                        # 下载并安装（默认版本 0.1.0-rc.6）
  ./install.sh --version 0.1.0-rc.6   # 指定版本
  ./install.sh --profile DIR          # 指定 profile（默认 ~/.dsh/profiles/desktop）
  ./install.sh --tgz-dir DIR          # 离线：用本地 tarball，不下载
  ./install.sh a.tgz b.tgz c.tgz      # 离线：直接给三个 tarball（任意顺序）
  ./install.sh --skill FILE           # 用本地 SKILL.md（默认从 release 下载）
  ./install.sh --dry-run              # 只预演，不执行
  -h, --help                          # 本帮助

三个 tarball（离线模式，按名字前缀识别）:
  deepseek-ai-dsh-roundtable-*.tgz
  deepseek-ai-dsh-tool-roundtable-*.tgz
  deepseek-ai-dsh-client-ui-roundtable-*.tgz
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

# ---- 解析 tarball 与 skill：离线 or 下载 ----
RT_TGZ=""; TOOL_TGZ=""; CLIENT_TGZ=""
OFFLINE=0
[[ ${#TARBALLS[@]} -gt 0 || -n "$TGZ_DIR" ]] && OFFLINE=1

if [[ "$OFFLINE" == 1 ]]; then
  if [[ ${#TARBALLS[@]} -gt 0 ]]; then
    for t in "${TARBALLS[@]}"; do
      [[ -f "$t" ]] || { echo "tarball 不存在: $t" >&2; exit 1; }
      case "$(basename "$t")" in
        deepseek-ai-dsh-roundtable-*.tgz) RT_TGZ="$t" ;;
        deepseek-ai-dsh-tool-roundtable-*.tgz) TOOL_TGZ="$t" ;;
        deepseek-ai-dsh-client-ui-roundtable-*.tgz) CLIENT_TGZ="$t" ;;
        *) echo "无法识别的 tarball 名: $(basename "$t")" >&2; exit 1 ;;
      esac
    done
  else
    [[ -d "$TGZ_DIR" ]] || { echo "目录不存在: $TGZ_DIR" >&2; exit 1; }
    pick() { # $1 = 前缀
      local matches=( "$TGZ_DIR"/"$1"-*.tgz )
      [[ ${#matches[@]} -gt 0 && -f "${matches[0]}" ]] || { echo "未找到 $1-*.tgz（目录: $TGZ_DIR）" >&2; exit 1; }
      echo "${matches[0]}"
    }
    RT_TGZ="$(pick deepseek-ai-dsh-roundtable)"
    TOOL_TGZ="$(pick deepseek-ai-dsh-tool-roundtable)"
    CLIENT_TGZ="$(pick deepseek-ai-dsh-client-ui-roundtable)"
  fi
  [[ -n "$RT_TGZ" && -n "$TOOL_TGZ" && -n "$CLIENT_TGZ" ]] \
    || { echo "需要三个 tarball：roundtable / tool-roundtable / client-ui-roundtable" >&2; exit 1; }
  SKILL="${SKILL:-./skill/SKILL.md}"
else
  command -v curl >/dev/null 2>&1 || { echo "未找到 curl（下载需要）" >&2; exit 1; }
  DL_DIR="$(mktemp -d)"
  trap 'rm -rf "$DL_DIR"' EXIT
  dl() { # $1 = 资产文件名
    local url="https://github.com/${RT_REPO}/releases/download/v${RT_VERSION}/$1"
    echo "下载 $url"
    curl -fL --retry 3 -o "$DL_DIR/$1" "$url" || { echo "下载失败: $url" >&2; exit 1; }
  }
  dl "deepseek-ai-dsh-roundtable-${RT_VERSION}.tgz"
  dl "deepseek-ai-dsh-tool-roundtable-${RT_VERSION}.tgz"
  dl "deepseek-ai-dsh-client-ui-roundtable-${RT_VERSION}.tgz"
  dl "SKILL.md"
  RT_TGZ="$DL_DIR/deepseek-ai-dsh-roundtable-${RT_VERSION}.tgz"
  TOOL_TGZ="$DL_DIR/deepseek-ai-dsh-tool-roundtable-${RT_VERSION}.tgz"
  CLIENT_TGZ="$DL_DIR/deepseek-ai-dsh-client-ui-roundtable-${RT_VERSION}.tgz"
  SKILL="$DL_DIR/SKILL.md"
fi

[[ -f "$SKILL" ]] || { echo "skill 文件不存在: $SKILL" >&2; exit 1; }

echo "profile : $PROFILE"
echo "版本     : $RT_VERSION"
echo "tarballs:"
echo "  - $RT_TGZ"
echo "  - $TOOL_TGZ"
echo "  - $CLIENT_TGZ"
echo "skill   : $SKILL"

if [[ "$DRY_RUN" == 1 ]]; then
  echo
  echo "[dry-run] 将执行: 复制 tarball → pnpm add → 写 cordis.patch.yml → 复制 skill"
  exit 0
fi

# ---- 1. 复制 tarball 进 profile（file: 引用指向稳定路径）----
mkdir -p "$PROFILE/roundtable-tgzs"
cp "$RT_TGZ" "$PROFILE/roundtable-tgzs/"
cp "$TOOL_TGZ" "$PROFILE/roundtable-tgzs/"
cp "$CLIENT_TGZ" "$PROFILE/roundtable-tgzs/"

# ---- 2. pnpm add ----
(
  cd "$PROFILE"
  pnpm add \
    "$PROFILE/roundtable-tgzs/$(basename "$RT_TGZ")" \
    "$PROFILE/roundtable-tgzs/$(basename "$TOOL_TGZ")" \
    "$PROFILE/roundtable-tgzs/$(basename "$CLIENT_TGZ")"
)

# ---- 3. 幂等写入 cordis.patch.yml ----
PATCH_FILE="$PROFILE/cordis.patch.yml"
PATCH_BLOCK=$(cat <<'EOF'

# Roundtable: 多智能体圆桌讨论（out-of-tree 插件）。
- insert:
    - id: roundtable
      name: '@deepseek-ai/dsh-roundtable'
      config:
        provider: spawn

    - id: tool-roundtable
      name: '@deepseek-ai/dsh-tool-roundtable'

    - id: ui-roundtable
      name: '@deepseek-ai/dsh-client-ui-roundtable'
EOF
)

if [[ -f "$PATCH_FILE" ]] && grep -q '@deepseek-ai/dsh-roundtable' "$PATCH_FILE"; then
  echo "cordis.patch.yml 已包含 roundtable 插件，跳过补丁。"
else
  if [[ ! -f "$PATCH_FILE" ]]; then
    printf '# 本 profile 的 patch 层：顶层 YAML 数组，每项是 loader patch entry。\n' > "$PATCH_FILE"
  fi
  printf '%s\n' "$PATCH_BLOCK" >> "$PATCH_FILE"
  echo "已写入 $PATCH_FILE"
fi

# ---- 4. 复制 skill ----
mkdir -p "$HOME/.agents/skills/roundtable"
cp "$SKILL" "$HOME/.agents/skills/roundtable/SKILL.md"
echo "已复制 skill → $HOME/.agents/skills/roundtable/SKILL.md"

echo
echo "✅ 安装完成。请完全重启 DSH Desktop 以加载宿主插件。"
