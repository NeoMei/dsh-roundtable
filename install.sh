#!/usr/bin/env bash
#
# install.sh — 把 dsh-roundtable 插件安装进一个 DSH profile。
#
# 前置：三个已构建的 tarball（见 README「构建」）。脚本会：
#   1. 把 tarball 复制到 profile 内的 roundtable-tgzs/（file: 依赖指向稳定路径）
#   2. pnpm add 三个包
#   3. 幂等地往 cordis.patch.yml 写入三个插件 insert 条目
#   4. 复制 skill 到 ~/.agents/skills/roundtable/SKILL.md
#
# 用法见 `usage()`。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PROFILE="${DSH_PROFILE:-$HOME/.dsh/profiles/desktop}"
TGZ_DIR="."
SKILL="$SCRIPT_DIR/skill/SKILL.md"
DRY_RUN=0
TARBALLS=()

usage() {
  cat <<'EOF'
安装 dsh-roundtable 到 DSH profile。

用法:
  ./install.sh [选项] [tarball...]

选项:
  --profile DIR   目标 profile 目录（默认 ~/.dsh/profiles/desktop，
                  或 $DSH_PROFILE）
  --tgz-dir DIR   三个 tarball 所在目录（默认当前目录）
  --skill FILE    SKILL.md 路径（默认 <脚本目录>/skill/SKILL.md）
  --dry-run       只打印将执行的操作，不真正执行
  -h, --help      显示本帮助

三个 tarball（任意顺序，按名字前缀识别）:
  deepseek-ai-dsh-roundtable-*.tgz
  deepseek-ai-dsh-tool-roundtable-*.tgz
  deepseek-ai-dsh-client-ui-roundtable-*.tgz
EOF
}

# ---- 参数解析 ----
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --tgz-dir) TGZ_DIR="$2"; shift 2 ;;
    --skill) SKILL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "未知选项: $1" >&2; usage >&2; exit 2 ;;
    *) TARBALLS+=("$1"); shift ;;
  esac
done

# ---- 解析 tarball（优先位置参数，否则在 --tgz-dir 里按前缀找）----
RT_TGZ=""; TOOL_TGZ=""; CLIENT_TGZ=""

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
    if [[ ${#matches[@]} -eq 0 || ! -f "${matches[0]}" ]]; then
      echo "未找到 $1-*.tgz（目录: $TGZ_DIR）" >&2; exit 1
    fi
    echo "${matches[0]}"
  }
  RT_TGZ="$(pick deepseek-ai-dsh-roundtable)"
  TOOL_TGZ="$(pick deepseek-ai-dsh-tool-roundtable)"
  CLIENT_TGZ="$(pick deepseek-ai-dsh-client-ui-roundtable)"
fi

[[ -n "$RT_TGZ" && -n "$TOOL_TGZ" && -n "$CLIENT_TGZ" ]] \
  || { echo "需要三个 tarball：roundtable / tool-roundtable / client-ui-roundtable" >&2; exit 1; }
[[ -f "$SKILL" ]] || { echo "skill 文件不存在: $SKILL" >&2; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "未找到 pnpm（DSH Desktop 的 PATH 自带；请确认已安装）" >&2; exit 1; }

echo "profile : $PROFILE"
echo "tarballs:"
echo "  - $RT_TGZ"
echo "  - $TOOL_TGZ"
echo "  - $CLIENT_TGZ"
echo "skill   : $SKILL"

if [[ "$DRY_RUN" == 1 ]]; then
  echo
  echo "[dry-run] 将执行:"
  echo "  1. 复制 tarball → $PROFILE/roundtable-tgzs/"
  echo "  2. cd $PROFILE && pnpm add <3 个 tarball>"
  echo "  3. 幂等写入 $PROFILE/cordis.patch.yml（若未包含则追加 insert 块）"
  echo "  4. 复制 skill → $HOME/.agents/skills/roundtable/SKILL.md"
  exit 0
fi

# ---- 1. 把 tarball 复制进 profile，file: 引用指向稳定路径 ----
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
