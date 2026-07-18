---
name: asc-build-lifecycle
description: Use when managing App Store Connect builds with the asc CLI — waiting on a build to finish processing, finding the latest or most recent builds for an app/version, distributing to TestFlight or submitting to the App Store, or expiring/cleaning up old builds for retention.
---

# asc Build Lifecycle

## Overview

Manage App Store Connect build **state, processing, and retention** with the `asc`
CLI. Use this to locate the right build, check where it is in processing, push it
to TestFlight or the App Store, and expire builds you no longer need.

Run `asc <command> --help` for the full flag set — this skill covers the common paths.

## When to Use

- Waiting on a freshly uploaded build to finish processing
- Finding the latest build, or listing recent builds, for an app or version
- Distributing a build to TestFlight testers or submitting it to the App Store
- Cleaning up old builds (expiration) to manage retention

## Quick Reference

| Goal | Command |
|------|---------|
| Latest build for a version | `asc builds latest --app "APP_ID" --version "1.2.3" --platform IOS` |
| List recent builds | `asc builds list --app "APP_ID" --sort -uploadedDate --limit 10` |
| Inspect processing state | `asc builds info --build "BUILD_ID"` |
| Publish to TestFlight | `asc publish testflight --app "APP_ID" --ipa "./app.ipa" --group "GROUP_ID" --wait` |
| Publish to App Store | `asc publish appstore --app "APP_ID" --ipa "./app.ipa" --version "1.2.3" --wait --submit --confirm` |
| Preview expiration | `asc builds expire-all --app "APP_ID" --older-than 90d --dry-run` |
| Apply expiration | `asc builds expire-all --app "APP_ID" --older-than 90d --confirm` |
| Expire a single build | `asc builds expire --build "BUILD_ID"` |

## Find the Right Build

Latest build for a version:

```bash
asc builds latest --app "APP_ID" --version "1.2.3" --platform IOS
```

Recent builds, newest first:

```bash
asc builds list --app "APP_ID" --sort -uploadedDate --limit 10
```

## Inspect Processing State

```bash
asc builds info --build "BUILD_ID"
```

## Distribution Flows

**Prefer the end-to-end `asc publish` commands** — they drive upload through
distribution in one step.

TestFlight:

```bash
asc publish testflight --app "APP_ID" --ipa "./app.ipa" --group "GROUP_ID" --wait
```

App Store:

```bash
asc publish appstore --app "APP_ID" --ipa "./app.ipa" --version "1.2.3" --wait --submit --confirm
```

## Cleanup / Retention

Preview which builds would expire (safe, no changes):

```bash
asc builds expire-all --app "APP_ID" --older-than 90d --dry-run
```

Apply the expiration:

```bash
asc builds expire-all --app "APP_ID" --older-than 90d --confirm
```

Expire a single build:

```bash
asc builds expire --build "BUILD_ID"
```

## Notes

- `asc builds upload` **prepares upload operations only** — for a full upload →
  distribution flow use `asc publish` instead.
- For long processing times, use `--wait`, `--poll-interval`, and `--timeout`
  where the command supports them.
