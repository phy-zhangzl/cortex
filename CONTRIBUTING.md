# Contributing

## Workflow

1. Sync from `main`
2. Create a working branch
3. Develop and test locally
4. Run validation
5. Commit with a structured message
6. Open a PR or merge after review
7. Tag only from `main`

## Branch naming

- `feature/<topic>`
- `fix/<topic>`
- `refactor/<topic>`
- `docs/<topic>`
- `chore/<topic>`

Examples:

- `feature/feed-import-export`
- `fix/content-fetch-timeout`

## Commit message convention

Use a lightweight conventional format:

- `feat:` new feature
- `fix:` bug fix
- `refactor:` internal restructuring
- `docs:` documentation
- `build:` packaging / CI / dependencies
- `chore:` maintenance

Examples:

- `fix(content): replace ureq with reqwest for article extraction`
- `docs(repo): add release and contribution workflow`

## Local validation

Run before pushing:

```bash
cd app
npm ci
npm run check
```

## Release rules

- Release only from `main`
- Update version numbers consistently
- Update `CHANGELOG.md`
- Create an annotated Git tag
- Publish the packaged artifact with release notes

## Tag format

Use annotated tags:

```bash
git tag -a v0.1.1 -m "Release v0.1.1"
```

## Pull request checklist

- [ ] Code builds locally
- [ ] `npm run check` passes
- [ ] Version/changelog updated if needed
- [ ] User-facing changes documented
- [ ] No debug-only code left behind
