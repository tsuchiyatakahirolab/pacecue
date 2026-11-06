$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
$repository = "tsuchiyatakahirolab/pacecue"
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "Install the official GitHub CLI from https://cli.github.com/ and run gh auth login."
}
gh auth status
if ($LASTEXITCODE -ne 0) { throw "Run gh auth login first. Do not paste credentials into source files." }
if (Test-Path ".git") { throw "This folder already has Git history. Inspect its remotes before publishing." }
npm ci
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
npm run check
if ($LASTEXITCODE -ne 0) { throw "Checks failed. Nothing was published." }
git init -b main
if ($LASTEXITCODE -ne 0) { throw "Git initialization failed." }
git add .
git commit -m "Add PaceCue 0.1.0: deadline-aware routines for G2"
if ($LASTEXITCODE -ne 0) { throw "Commit failed. Set your Git user.name and user.email, then retry manually." }
gh repo create $repository --public --source . --remote origin --push --description "Free offline deadline-aware daily routines for Even G2."
if ($LASTEXITCODE -ne 0) { throw "Publication did not complete. Inspect GitHub and the local remote before retrying; do not overwrite an existing repository." }
gh repo view $repository --json nameWithOwner,url,visibility,defaultBranchRef
