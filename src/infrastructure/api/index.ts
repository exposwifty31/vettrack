/**
 * API adapter barrel.
 * The api singleton from src/lib/api.ts is the canonical HTTP client.
 * Re-export it here so features can import from @/infrastructure/api
 * without depending directly on src/lib/.
 */
export { api } from "@/lib/api";
