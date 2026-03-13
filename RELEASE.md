# Release Process

## 1. Prepare the release

Update version numbers in:

- `app/package.json`
- `app/src-tauri/Cargo.toml`
- `app/src-tauri/tauri.conf.json`
- `CHANGELOG.md`

## 2. Validate locally

```bash
cd app
npm ci
npm run check
npm run tauri:build
```

## 3. Commit release changes

```bash
git add .
git commit -m "chore(release): prepare vX.Y.Z"
```

## 4. Tag the release

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

## 5. Push code and tags

```bash
git push origin main
git push origin --tags
```

## 6. Publish GitHub release

Create a GitHub Release from the matching tag and attach packaged artifacts, such as:

- `.dmg`
- `.app` bundle archive if needed

## Release checklist

- [ ] Version updated in all required files
- [ ] Changelog updated
- [ ] CI is green
- [ ] App launches successfully
- [ ] Feed sync works
- [ ] Full-text extraction works
- [ ] AI analysis works
- [ ] macOS DMG generated
