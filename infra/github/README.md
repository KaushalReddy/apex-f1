# infra/github

GitHub only executes workflows from `.github/workflows/` at the repository root, so the
CI workflow lives there (`.github/workflows/ci.yml`). This folder is reserved for other
GitHub-side config we may add (issue templates, CODEOWNERS, Dependabot config templates).
