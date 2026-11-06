#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
repository="tsuchiyatakahirolab/pacecue"
command -v gh >/dev/null || { echo "Install the official GitHub CLI from https://cli.github.com/ and run gh auth login."; exit 1; }
gh auth status
if [ -e .git ]; then
  echo "This folder already has Git history. Inspect its remotes before publishing."
  exit 1
fi
npm ci
npm run check
git init -b main
git add .
git commit -m "Add PaceCue 0.1.0: deadline-aware routines for G2"
gh repo create "$repository" --public --source . --remote origin --push --description "Free offline deadline-aware daily routines for Even G2."
gh repo view "$repository" --json nameWithOwner,url,visibility,defaultBranchRef
