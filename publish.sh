#!/usr/bin/env bash
#
# publish.sh — publish Markdown SQL Lint to the VS Code Marketplace.
#
# Publishes the version currently in package.json as publisher MB42. It compiles
# and (re)packages the .vsix if one for this version isn't already present, then
# publishes that exact artifact (no implicit version bump).
#
# Auth: needs an Azure DevOps Personal Access Token for the MB42 publisher.
#   export VSCE_PAT=xxxx   ./publish.sh
#   ./publish.sh xxxx                  # PAT as first arg
#
# Optional:
#   ./publish.sh --tag                 # also create+push git tag vX.Y.Z after publish
#   ./publish.sh xxxx --tag
#
set -euo pipefail

cd "$(dirname "$0")"

# --- args ---------------------------------------------------------------------
TAG=0
PAT="${VSCE_PAT:-}"
for arg in "$@"; do
  case "$arg" in
    --tag) TAG=1 ;;
    -*)    echo "Unknown flag: $arg" >&2; exit 2 ;;
    *)     PAT="$arg" ;;
  esac
done

if [[ -z "$PAT" ]]; then
  echo "No PAT. Set VSCE_PAT or pass it as the first argument." >&2
  echo "  export VSCE_PAT=xxxx && ./publish.sh   (or)   ./publish.sh xxxx" >&2
  exit 1
fi

# --- version + artifact -------------------------------------------------------
VERSION="$(node -p "require('./package.json').version")"
VSIX="markdown-sql-lint-${VERSION}.vsix"

if [[ ! -f "$VSIX" ]]; then
  echo "==> No $VSIX found; compiling and packaging…"
  npm run compile
  npx -y @vscode/vsce package
else
  echo "==> Using existing $VSIX"
fi

# --- confirm (publishing is public + hard to undo) ----------------------------
echo
echo "About to publish $VSIX as publisher MB42 to the VS Code Marketplace."
read -r -p "Proceed? [y/N] " reply
[[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# --- publish ------------------------------------------------------------------
npx -y @vscode/vsce publish --packagePath "$VSIX" -p "$PAT"
echo "==> Published v$VERSION"

# --- optional git tag ---------------------------------------------------------
if [[ "$TAG" == "1" ]]; then
  if git rev-parse "v$VERSION" >/dev/null 2>&1; then
    echo "==> Tag v$VERSION already exists; skipping."
  else
    git tag "v$VERSION"
    for remote in origin github; do
      git remote get-url "$remote" >/dev/null 2>&1 && git push "$remote" "v$VERSION"
    done
    echo "==> Tagged and pushed v$VERSION"
  fi
fi
