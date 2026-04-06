# Release Process

## Core Rule

**CI/CD and infrastructure changes go to `main` first. Release branches contain only version bumps.**

This matters because `release.yml` uses `uses: ./.github/workflows/test.yml`, which always loads that file from the **calling branch** (`main`), not from the release branch. Any matrix or pipeline changes on a release branch are invisible to the release workflow.

## Step-by-Step Release

### 1. Land all changes on `main`

Features, bug fixes, CI changes, and documentation all go through PRs to `main`. Never add these directly to a release branch.

```bash
git checkout main && git pull
```

### 2. Create the release branch

```bash
git checkout -b release-X main
```

### 3. Bump the version (only change allowed on a release branch)

```bash
npm version patch   # or minor / major
git push origin release-X --follow-tags
```

### 4. Trigger the release pipeline

```bash
gh workflow run release.yml \
  --ref release-X \
  --field release_branch_name=release-X \
  --field npmjs_dist_tag=latest
```

Use `npmjs_dist_tag=beta` for pre-releases.

## Node.js Version Policy

- **Minimum supported**: Node.js 20 (Node 18 is EOL)
- **`package.json` engines**: `"node": ">=20.0.0"` — keep in sync with the runtime guard
- **Runtime guard**: Both `src/cli.ts` and `src/cli/index.ts` check `process.versions.node` before any imports and exit with a clear error on Node < 20
- **CI matrix**: Tests run on Node 20, 22, and 24 (`fail-fast: false` so all legs report)
- **Dist artifact**: Uploaded from the Node 22 matrix leg only (canonical LTS build)

## After a Successful Release

Once the package is published, merge the release branch back into `main` so the version bump is not lost:

```bash
git checkout main && git pull
git merge release-X --no-ff -m "chore: merge release-X back to main"
git push origin main
```

Or open a PR from `release-X` → `main` if your repo requires PR reviews on `main`.

The release branch can then be deleted:

```bash
git push origin --delete release-X
git branch -d release-X
```

## If You Need to Fix a Release Branch

If a release branch has a broken pipeline (e.g., missing matrix, wrong Node version):

1. Fix it on `main` first (PR or direct commit)
2. Cherry-pick the fix commits to the release branch (skip any version bump commits)
3. Re-trigger the pipeline

```bash
git checkout main
# ... make fix, commit ...
git checkout release-X
git cherry-pick <fix-sha> [<fix-sha2> ...]
git push origin release-X
gh workflow run release.yml --ref release-X ...
```

## Why `fail-fast: false`

With `fail-fast: false`, all three Node version legs (20, 22, 24) run to completion even if one fails. This gives full cross-version visibility in a single CI run. The overall workflow still fails if any leg fails, which blocks the release pipeline just as `fail-fast: true` would.
