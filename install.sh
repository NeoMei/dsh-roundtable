#!/usr/bin/env bash
#
# install.sh — 一键安装 dsh-roundtable 到 DSH profile。
#
# 默认：把仓库根当作**一个 bundle 包**装进 profile（`dsh.bundle.patch` 声明了
# 三个插件行），再复制 skill。无需本地构建。
#
# 本脚本**不再**改写 profile 的 cordis.patch.yml：插件靠自己的 `dsh.bundle.patch`
# 供 patch 行，脚本只负责把包装上、并把这些 bundle 选入 `dsh.profile.bundles`
# （`dsh plugin add` 在 pnpm 之后做的那一步）。手写 patch 既多余，又会和 bundle
# 自带的 patch 撞 entry id，还会把模板里的 `[]` 追加成非法 YAML。

set -euo pipefail

RT_REPO="${RT_REPO:-NeoMei/dsh-roundtable}"
RT_VERSION="${RT_VERSION:-0.1.0-rc.6}"
RT_REF="${RT_REF:-}"
PROFILE="${DSH_PROFILE:-$HOME/.dsh/profiles/desktop}"

TGZ_DIR=""
SKILL=""
TARBALLS=()
DRY_RUN=0
PACKAGES=0

usage() {
  cat <<'EOF'
一键安装 dsh-roundtable 到 DSH profile。

默认: 把仓库根当作一个 bundle 包装进 profile + 下载 skill（无需本地构建）。

用法:
  ./install.sh                        # 默认分支的 bundle（推荐）
  ./install.sh --ref v0.1.0-rc.7      # 固定到某个 git ref（分支 / tag / commit）
  ./install.sh --packages             # 备选：从 npm 装三个 @neomei/dsh-* 包
  ./install.sh --version 0.1.0-rc.6   # --packages 的版本；也是 skill 的 release 版本
  ./install.sh --profile DIR          # 指定 profile（默认 ~/.dsh/profiles/desktop）
  ./install.sh --tgz-dir DIR          # 离线：用三个 @neomei/* tarball，不联网装包
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
    --ref) RT_REF="$2"; shift 2 ;;
    --repo) RT_REPO="$2"; shift 2 ;;
    --tgz-dir) TGZ_DIR="$2"; shift 2 ;;
    --skill) SKILL="$2"; shift 2 ;;
    --packages) PACKAGES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "未知选项: $1" >&2; usage >&2; exit 2 ;;
    *) TARBALLS+=("$1"); shift ;;
  esac
done

command -v pnpm >/dev/null 2>&1 || { echo "未找到 pnpm（DSH Desktop 的 PATH 自带；请确认已安装）" >&2; exit 1; }

# ---- skill：优先用仓库内的，其次从 release 下载 ----
if [[ -z "$SKILL" && -f "./skill/SKILL.md" ]]; then
  SKILL="./skill/SKILL.md"
fi
if [[ -z "$SKILL" ]]; then
  command -v curl >/dev/null 2>&1 || { echo "未找到 curl（下载 skill 需要）" >&2; exit 1; }
  DL_DIR="$(mktemp -d)"
  trap 'rm -rf "$DL_DIR"' EXIT
  SKILL_URL="https://github.com/${RT_REPO}/releases/download/v${RT_VERSION}/SKILL.md"
  echo "下载 $SKILL_URL"
  curl -fL --retry 3 -o "$DL_DIR/SKILL.md" "$SKILL_URL" || { echo "下载失败: $SKILL_URL" >&2; exit 1; }
  SKILL="$DL_DIR/SKILL.md"
fi
[[ -f "$SKILL" ]] || { echo "skill 文件不存在: $SKILL" >&2; exit 1; }

if [[ ${#TARBALLS[@]} -gt 0 || -n "$TGZ_DIR" ]]; then
  MODE="离线 tarball（三个 @neomei/* 包）"
elif [[ "$PACKAGES" == 1 ]]; then
  MODE="npm（三个 @neomei/* 包，${RT_VERSION}）"
else
  MODE="git bundle（github:${RT_REPO}${RT_REF:+#${RT_REF}}）"
fi
echo "profile : $PROFILE"
echo "安装方式 : $MODE"
echo "skill   : $SKILL"

if [[ "$DRY_RUN" == 1 ]]; then
  echo
  echo "[dry-run] 将执行: 安装插件包 → 把声明 dsh.bundle 的依赖选入 dsh.profile.bundles → 复制 skill"
  exit 0
fi

mkdir -p "$PROFILE"

# ---- 1. 安装插件包 ----
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
elif [[ "$PACKAGES" == 1 ]]; then
  (
    cd "$PROFILE"
    pnpm add \
      "@neomei/dsh-roundtable@${RT_VERSION}" \
      "@neomei/dsh-tool-roundtable@${RT_VERSION}" \
      "@neomei/dsh-client-ui-roundtable@${RT_VERSION}"
  )
else
  # 仓库根是一个 bundle：它的 cordis.patch.yml 插入全部三行，dependencies 把
  # 三个 @neomei/* 包一并装进 profile，所以一次安装就够了。
  (
    cd "$PROFILE"
    pnpm add "github:${RT_REPO}${RT_REF:+#${RT_REF}}"
  )
fi

# ---- 2. 把装了 bundle 的依赖选进 dsh.profile.bundles ----
#
# `dsh plugin add` 会在 pnpm 之后 reconcile 这一步；裸 `pnpm add`（本脚本走的路）
# 不会，于是包装上了却永远不激活。这里做同一件事：遍历 dependencies，凡
# package.json 声明了 dsh.bundle 的就追加进 dsh.profile.bundles（幂等）。
command -v node >/dev/null 2>&1 || { echo "未找到 node（选入 bundle 需要）" >&2; exit 1; }
node - "$PROFILE" <<'EOF'
const fs = require('node:fs')
const path = require('node:path')

const profileDir = process.argv[2]
const manifestPath = path.join(profileDir, 'package.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

const bundles = manifest.dsh?.profile?.bundles ?? []
const selected = []

for (const name of Object.keys(manifest.dependencies ?? {})) {
  const installed = path.join(profileDir, 'node_modules', name, 'package.json')
  if (!fs.existsSync(installed)) continue
  const dependency = JSON.parse(fs.readFileSync(installed, 'utf8'))
  if (dependency.dsh?.bundle?.patch === undefined) continue
  if (!bundles.includes(name)) {
    bundles.push(name)
    selected.push(name)
  }
}

if (selected.length > 0) {
  manifest.dsh = {
    ...manifest.dsh,
    profile: { ...manifest.dsh?.profile, bundles },
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
  console.log(`已选入 dsh.profile.bundles: ${selected.join(', ')}`)
} else {
  console.log('dsh.profile.bundles 已包含本插件的 bundle，无需改动。')
}
EOF

# ---- 3. 复制 skill ----
mkdir -p "$HOME/.agents/skills/roundtable"
cp "$SKILL" "$HOME/.agents/skills/roundtable/SKILL.md"
echo "已复制 skill → $HOME/.agents/skills/roundtable/SKILL.md"

echo
echo "✅ 安装完成。请完全重启 DSH Desktop 以加载插件（roundtable / tool-roundtable / ui-roundtable）。"
