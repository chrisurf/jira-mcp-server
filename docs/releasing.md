# Releasing

This project uses **Semantic Versioning** (semver) and **Conventional Commits** for automated changelog generation.

## Version Format

```
v<major>.<minor>.<patch>
```

| Increment | When |
|---|---|
| **major** | Breaking changes (API removal, incompatible config changes) |
| **minor** | New features (new tools, new config options) |
| **patch** | Bug fixes, performance improvements, documentation |

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/) for all commits on `main`. The release pipeline uses these prefixes to generate categorized changelogs:

```
feat: add get_issue_labels tool          # -> Features section
fix: handle empty JQL query gracefully   # -> Bug Fixes section
feat!: rename projectKey to project_key  # -> Breaking Changes section
refactor: extract shared validation      # -> Other Changes section
docs: update README with new tools       # -> Other Changes section
chore: update dependencies               # -> Other Changes section
```

## How to Create a Release

### Option 1: GitHub UI (recommended)

1. Go to **Releases** > **Draft a new release**
2. Click **Choose a tag** > type `v1.0.0` > **Create new tag on publish**
3. Set **Target** to `main`
4. Title: `v1.0.0`
5. Click **Publish release**

The pipeline will automatically:
- Run all CI checks (lint, typecheck, test, security audit)
- Build and push a Docker image to `ghcr.io`
- Generate release notes from conventional commits
- Update the GitHub Release with the changelog

### Option 2: Git CLI

```bash
# Make sure you're on main with all changes committed
git checkout main
git pull

# Create and push the tag
git tag v1.0.0
git push origin v1.0.0
```

Then create the GitHub Release via the UI or `gh`:

```bash
gh release create v1.0.0 --title "v1.0.0" --generate-notes
```

## Pipeline Overview

### CI (`ci.yml`) — runs on every push/PR to `main`

```
lint-and-typecheck
       |
      test ──── security-audit
       |              |
       └──── build ───┘
```

### Release (`release.yml`) — runs on `v*` tags

```
validate (semver check)
       |
lint-and-typecheck ──── security-audit
       |                      |
      test                    |
       |                      |
      build ──────────────────┘
       |
  ┌────┴────┐
docker   publish-npm (optional)
  |
release-notes
```

## Docker Images

After a release, the Docker image is available at:

```bash
# Exact version
docker pull ghcr.io/<owner>/jira-mcp-server:1.0.0

# Major.minor (auto-updated)
docker pull ghcr.io/<owner>/jira-mcp-server:1.0

# Major only (auto-updated)
docker pull ghcr.io/<owner>/jira-mcp-server:1

# Latest from main
docker pull ghcr.io/<owner>/jira-mcp-server:latest
```

## npm Publishing (Optional)

To enable npm publishing:

1. Create an npm access token at [npmjs.com](https://www.npmjs.com/settings/~/tokens)
2. Add it as repository secret `NPM_TOKEN`
3. Create repository variable `PUBLISH_NPM` with value `true`

## Secrets & Variables

| Name | Type | Required | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | Secret | Auto | Provided by GitHub, used for GHCR and releases |
| `NPM_TOKEN` | Secret | Optional | npm access token for publishing |
| `PUBLISH_NPM` | Variable | Optional | Set to `true` to enable npm publishing |
