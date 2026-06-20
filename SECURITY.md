# Security Policy

## Supported Versions

Only the current production release of VetTrack receives security fixes.

| Version | Supported |
|---------|-----------|
| 1.0.x (current) | ✅ |
| < 1.0  | ❌ |

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
