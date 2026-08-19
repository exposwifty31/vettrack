# Security Policy

## Supported Versions

Only the **current production release** of VetTrack receives security fixes. Anything
older is unsupported — upgrade before reporting.

| Version | Supported |
|---------|-----------|
| The version currently live on the App Store | ✅ |
| Any earlier release | ❌ |

This file deliberately does **not** name the version number. Hand-copied version numbers
drift (this table said `1.0.x` long after the app shipped 1.2.0); numbers re-derived at
read time do not.

**`package.json` is the release TARGET, not proof of what shipped.** `pnpm resubmit:release`
bumps it before the archive is uploaded, and an upload can be rejected — so between the bump
and a successful review this repo names a version that is not live anywhere. Do not read the
supported version out of the working tree. The App Store is the only record of what shipped:

```bash
asc builds list --app 6778937527 --limit 5     # what is actually live / in review
```

The repo-side numbers are the candidate, useful for checking the two are consistent with each
other before a submission — not for answering "what is supported":

```bash
node -p "require('./package.json').version"                        # candidate marketing version
grep -m1 MARKETING_VERSION ios/App/App.xcodeproj/project.pbxproj   # iOS, must match
grep -m1 CURRENT_PROJECT_VERSION ios/App/App.xcodeproj/project.pbxproj
cat ios/.last-shipped-build                                        # last build uploaded (build only, no marketing version)
```

There is deliberately no `ios/.last-shipped-version` file: a second hand-maintained record
would drift the same way the old table did. Ask App Store Connect.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in VetTrack, please disclose it responsibly:

- **Email:** security@vettrack.uk
- **Response time:** We aim to acknowledge reports within 48 hours and provide a resolution timeline within 7 days.

### What to include

- A description of the vulnerability and its potential impact
- Steps to reproduce (proof-of-concept if available)
- Affected versions (if known)

### What to expect

1. Acknowledgement of your report within 48 hours
2. An assessment of severity and scope within 7 days
3. A fix deployed to production, with you credited (if you wish) upon resolution
4. We do not pursue legal action against researchers who follow responsible disclosure

## Scope

Areas of highest security sensitivity in this codebase:

- **Multi-tenancy boundary** (`clinicId` isolation) — cross-clinic data access is a critical defect
- **Authentication** (`server/middleware/auth.ts`, Clerk integration)
- **Code Blue / emergency paths** — must never be offline-queued or silently blocked
- **Inventory dispense and medication workflows** — audit trail integrity
- **Integration credentials** — encrypted at rest; report any credential exposure immediately

## Out of Scope

- Vulnerabilities in third-party dependencies that are already publicly known and tracked
- Social engineering attacks targeting staff
- Physical security of clinic hardware
