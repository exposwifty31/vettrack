# INTENTIONALLY EMPTY — this file runs as root on cloud/VM session start, so it carries no
# commands. Environment bootstrapping lives in the `SessionStart` hook in `.claude/settings.json`
# (guarded by `CLAUDE_CODE_REMOTE`, runs `pnpm install --frozen-lockfile` as the normal user).
# It previously ran `sudo apt-get install postgresql-16`, `sudo pg_createcluster`, and
# `sudo -u postgres psql -c "CREATE USER ..."` — unreviewed root commands are exactly what
# the empty-file rule exists to prevent. Do not add commands here. Local Postgres is set up
# by hand per `docs/setup/environment.md`; DB-integration suites are excluded from `pnpm test`
# by default and are run deliberately (`pnpm test:db-integration`, `pnpm test:integration:ops`).
