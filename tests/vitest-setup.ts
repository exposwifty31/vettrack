// In the browser bundle `en` is lazy-loaded (kept off first paint); tests run in a node
// env with no async load, so preload it synchronously to restore the sync
// refreshTranslations("en") contract (e.g. tests/t12-doc-title-and-casing.test.ts).
import enDict from "../locales/en.json";
import { registerLocaleDict, type LocaleDict } from "@/lib/i18n";

// Provide a dummy DATABASE_URL so server-side modules that import server/db.ts
// at module load time do not throw during unit tests that don't need a real DB.
if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
  process.env.DATABASE_URL = "postgres://vettrack:vettrack@127.0.0.1:5432/vettrack_test";
}

registerLocaleDict("en", enDict as unknown as LocaleDict);
