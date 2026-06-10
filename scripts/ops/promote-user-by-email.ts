/**
 * Promote an existing vt_users row to active admin by email.
 *
 * Production (Railway shell):
 *   railway run --service vettrack pnpm exec tsx scripts/ops/promote-user-by-email.ts \
 *     --email=your-email@example.com --allow-production
 *
 * Also set ADMIN_EMAILS on Railway so future logins self-heal (comma-separated list).
 */
import "dotenv/config";
import { Client } from "pg";

type Args = {
  email: string;
  allowProduction: boolean;
};

function parseArgs(argv: string[]): Args {
  let email = "";
  let allowProduction = false;
  for (const arg of argv.slice(2)) {
    if (arg === "--allow-production") {
      allowProduction = true;
      continue;
    }
    const m = /^--email=(.*)$/.exec(arg);
    if (m) email = m[1].trim();
  }
  if (!email) {
    console.error("Usage: tsx scripts/ops/promote-user-by-email.ts --email=<email> [--allow-production]");
    process.exit(3);
  }
  return { email, allowProduction };
}

function getDatabaseUrl(): string {
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
  if (!url) throw new Error("DATABASE_URL (or POSTGRES_URL) is not set");
  return url;
}

function looksLikeProduction(url: string, nodeEnv: string): boolean {
  if (nodeEnv === "production") return true;
  const lower = url.toLowerCase();
  return (
    lower.includes("railway.app") ||
    lower.includes("railway.internal") ||
    lower.includes("neon.tech") ||
    lower.includes("supabase.co")
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const dbUrl = getDatabaseUrl();
  const nodeEnv = (process.env.NODE_ENV ?? "").trim().toLowerCase();

  if (looksLikeProduction(dbUrl, nodeEnv) && !args.allowProduction) {
    console.error(
      "Refusing to run against a production-looking DATABASE_URL without --allow-production.",
    );
    process.exit(3);
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const found = await client.query(
      `SELECT id, clerk_id, email, name, role, status, clinic_id, deleted_at
         FROM vt_users
        WHERE LOWER(email) = LOWER($1)
        ORDER BY created_at ASC`,
      [args.email],
    );

    if (found.rows.length === 0) {
      console.error(
        JSON.stringify(
          {
            action: "not-found",
            email: args.email,
            hint: "Sign in once on vettrack.uk so Clerk provisions vt_users, then re-run this script.",
          },
          null,
          2,
        ),
      );
      process.exit(2);
    }

    const active = found.rows.filter((r: { deleted_at: unknown }) => r.deleted_at == null);
    if (active.length === 0) {
      console.error(JSON.stringify({ action: "all-deleted", rows: found.rows }, null, 2));
      process.exit(2);
    }

    const target = active[0] as {
      id: string;
      clerk_id: string;
      email: string;
      role: string;
      status: string;
      clinic_id: string;
    };

    const updated = await client.query(
      `UPDATE vt_users
          SET status = 'active', role = 'admin'
        WHERE id = $1
          AND deleted_at IS NULL
      RETURNING id, clerk_id, email, name, role, status, clinic_id`,
      [target.id],
    );

    console.log(
      JSON.stringify(
        {
          action: "promoted",
          before: { role: target.role, status: target.status, clinic_id: target.clinic_id },
          user: updated.rows[0],
          railwayHint:
            "Set ADMIN_EMAILS to include this email (comma-separated) on the production service, then redeploy.",
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[promote-user-by-email] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
