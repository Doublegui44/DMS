#!/bin/sh
# Deploy the app to a Hugging Face Docker Space (D-085).
#
#   scripts/deploy-hf.sh <hf-user>/<space-name>
#
# Copies the working tree as git sees it (tracked files plus new files that are not ignored, so
# .env files never leave this machine), swaps in the Space card from deploy/huggingface/README.md
# and force-pushes it as one commit to https://huggingface.co/spaces/<hf-user>/<space-name>.
# Hugging Face then builds the Dockerfile (install, seed, Next.js build: about 10 minutes).
#
# Authentication is your own: git asks for your Hugging Face username and an access token with
# write permission the first time, and the macOS keychain remembers them. This script never reads
# or stores a token. Binary files need git-lfs (brew install git-lfs).
set -e

SPACE="$1"
case "$SPACE" in
  */*) ;;
  *) echo "Usage: scripts/deploy-hf.sh <hf-user>/<space-name>" >&2; exit 1 ;;
esac

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [ -n "$(git status --porcelain)" ]; then
  echo "Note: deploying uncommitted changes too (the working tree, not only the last commit)."
fi

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

{ git ls-files; git ls-files --others --exclude-standard; } | sort -u | while IFS= read -r f; do
  [ -f "$f" ] || continue # deleted but not yet committed
  mkdir -p "$OUT/$(dirname "$f")"
  cp -p "$f" "$OUT/$f"
done
cp deploy/huggingface/README.md "$OUT/README.md"

cd "$OUT"
git init -q -b main
BINARIES="$(git ls-files --others | while IFS= read -r f; do
  file -b --mime "$f" | grep -q 'charset=binary' && echo "$f"
done || true)"
if [ -n "$BINARIES" ]; then
  if ! git lfs version >/dev/null 2>&1; then
    echo "Hugging Face only accepts binary files through git-lfs. Install it first: brew install git-lfs" >&2
    echo "Binary files: $BINARIES" >&2
    exit 1
  fi
  git lfs install --local >/dev/null
  echo "$BINARIES" | while IFS= read -r f; do git lfs track --filename "$f" >/dev/null; done
fi

git add -A
git -c user.name="$(git -C "$ROOT" config user.name)" -c user.email="$(git -C "$ROOT" config user.email)" \
  commit -q -m "Deploy $(git -C "$ROOT" rev-parse --short HEAD)$( [ -n "$(git -C "$ROOT" status --porcelain)" ] && echo ' + local changes')"
git push --force "https://huggingface.co/spaces/$SPACE" main

echo "Pushed. Follow the build at https://huggingface.co/spaces/$SPACE (Logs → Build)."
echo "Once it is running, open https://$(echo "$SPACE" | tr '/' '-' | tr '[:upper:]_.' '[:lower:]--').hf.space"
