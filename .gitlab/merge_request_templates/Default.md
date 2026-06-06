## Summary

<!-- What changed and why (1–3 sentences) -->

## Type

- [ ] feat
- [ ] fix
- [ ] chore
- [ ] docs
- [ ] refactor
- [ ] test

## Checklist

- [ ] Branch is **not** `main` (MR targets `main` or `staging`)
- [ ] `npx tsc --noEmit` passes locally
- [ ] Relevant tests run (`pnpm test` or targeted suite)
- [ ] No Railway / production / deployment config changes (unless explicitly approved)
- [ ] Locale keys added in **both** `locales/en.json` and `locales/he.json` (if user-facing copy changed)
- [ ] Every new/changed DB query is `clinicId`-scoped

## Issues

<!-- Closes #123 or Refs #123 -->

## CI

<!-- Link to pipeline after push; confirm squash-merge if intermediate commits were red -->

## GitHub sync note

<!-- Optional: note if this MR should be replayed to GitHub after account recovery -->
