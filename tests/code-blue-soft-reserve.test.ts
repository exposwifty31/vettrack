/**
 * R-CBF-1.2 · Soft-reserve = additive custody hint (compare-and-set).
 *
 * A nullable `reservedForSessionId` advisory hint on a crash-cart's
 * vt_equipment row. It NEVER blocks a clinician grabbing a different cart.
 * The reservation is set via compare-and-set (write only where the column is
 * currently NULL); on a CAS miss the loser re-resolves to the next eligible
 * ready cart and never overwrites; if none remain it returns an explicit
 * no-cart-available signal (the session still starts — the reservation is
 * advisory). Cleanup (failed or ended session) clears ONLY the session's own
 * reservation, scoped by session id, never another session's.
 *
 * Frozen Code Blue doctrine: additive column; no change to custody-toggle
 * semantics; RFID/custody non-goals preserved.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  reserveNearestReadyCart,
  clearReservationForSession,
  DrizzleCartReservationStore,
  type CartReservationStore,
  type SoftReserveResult,
} from "../server/lib/code-blue-soft-reserve.js";
import { equipment } from "../server/db.js";

const CLINIC = "clinic-1";
const OTHER_CLINIC = "clinic-2";

/**
 * Faithful in-memory model of the compare-and-set semantics the Drizzle store
 * issues against Postgres: reserve succeeds ONLY where reservedForSessionId is
 * currently NULL and the row is in the caller's clinic; clear affects ONLY
 * rows currently equal to the caller's own session id, in the caller's clinic.
 */
class InMemoryCartStore implements CartReservationStore {
  readonly carts = new Map<string, { clinicId: string; reservedForSessionId: string | null }>();

  seed(cartId: string, clinicId: string): void {
    this.carts.set(cartId, { clinicId, reservedForSessionId: null });
  }

  reservedOf(cartId: string): string | null {
    return this.carts.get(cartId)?.reservedForSessionId ?? null;
  }

  async compareAndReserve(clinicId: string, cartId: string, sessionId: string): Promise<boolean> {
    const cart = this.carts.get(cartId);
    if (!cart || cart.clinicId !== clinicId) return false;
    if (cart.reservedForSessionId !== null) return false; // CAS guard: only where NULL
    cart.reservedForSessionId = sessionId;
    return true;
  }

  async clearBySession(clinicId: string, sessionId: string): Promise<void> {
    for (const cart of this.carts.values()) {
      if (cart.clinicId === clinicId && cart.reservedForSessionId === sessionId) {
        cart.reservedForSessionId = null;
      }
    }
  }
}

describe("R-CBF-1.2 · soft-reserve behavior (collision + cleanup)", () => {
  it("reserving a ready cart sets the reservedForSessionId hint", async () => {
    const store = new InMemoryCartStore();
    store.seed("cartA", CLINIC);

    const result = await reserveNearestReadyCart(store, CLINIC, "sess-1", ["cartA"]);

    expect(result).toEqual<SoftReserveResult>({ reserved: true, cartId: "cartA" });
    expect(store.reservedOf("cartA")).toBe("sess-1");
  });

  it("a checkout of a DIFFERENT cart is unaffected by a reservation (custody-orthogonal)", async () => {
    const store = new InMemoryCartStore();
    store.seed("cartA", CLINIC);
    store.seed("cartB", CLINIC);

    await reserveNearestReadyCart(store, CLINIC, "sess-1", ["cartA"]);
    // A checkout of cartB never touches the reservation column — additive hint only.
    expect(store.reservedOf("cartA")).toBe("sess-1");
    expect(store.reservedOf("cartB")).toBeNull();
  });

  it("two concurrent starts: the loser re-resolves to the next cart and neither clears the other's reservation", async () => {
    const store = new InMemoryCartStore();
    store.seed("cartA", CLINIC);
    store.seed("cartB", CLINIC);

    // Both sessions consider the same ordered candidate list; winner takes cartA.
    const winner = await reserveNearestReadyCart(store, CLINIC, "sess-1", ["cartA", "cartB"]);
    const loser = await reserveNearestReadyCart(store, CLINIC, "sess-2", ["cartA", "cartB"]);

    expect(winner).toEqual<SoftReserveResult>({ reserved: true, cartId: "cartA" });
    // The loser could not overwrite cartA (CAS miss) and received the next eligible cart.
    expect(loser).toEqual<SoftReserveResult>({ reserved: true, cartId: "cartB" });
    expect(store.reservedOf("cartA")).toBe("sess-1");
    expect(store.reservedOf("cartB")).toBe("sess-2");

    // Cleanup is session-scoped: clearing sess-1 must not touch sess-2's reservation.
    await clearReservationForSession(store, CLINIC, "sess-1");
    expect(store.reservedOf("cartA")).toBeNull();
    expect(store.reservedOf("cartB")).toBe("sess-2");
  });

  it("with only one cart, the loser gets an explicit no-cart-available signal (session still starts)", async () => {
    const store = new InMemoryCartStore();
    store.seed("cartA", CLINIC);

    await reserveNearestReadyCart(store, CLINIC, "sess-1", ["cartA"]);
    const loser = await reserveNearestReadyCart(store, CLINIC, "sess-2", ["cartA"]);

    expect(loser).toEqual<SoftReserveResult>({ reserved: false, reason: "no_cart_available" });
    // The winner's reservation is never overwritten by the losing session.
    expect(store.reservedOf("cartA")).toBe("sess-1");
  });

  it("a failed session and an ended session each clear ONLY their own hint", async () => {
    const store = new InMemoryCartStore();
    store.seed("cartA", CLINIC);
    store.seed("cartB", CLINIC);
    await reserveNearestReadyCart(store, CLINIC, "sess-failed", ["cartA"]);
    await reserveNearestReadyCart(store, CLINIC, "sess-ended", ["cartB"]);

    // Failed-session cleanup clears only its own reservation.
    await clearReservationForSession(store, CLINIC, "sess-failed");
    expect(store.reservedOf("cartA")).toBeNull();
    expect(store.reservedOf("cartB")).toBe("sess-ended");

    // Ended-session cleanup clears only its own reservation.
    await clearReservationForSession(store, CLINIC, "sess-ended");
    expect(store.reservedOf("cartB")).toBeNull();
  });

  it("compare-and-set and clear are clinic-scoped (cross-tenant isolation)", async () => {
    const store = new InMemoryCartStore();
    store.seed("cartA", CLINIC);
    store.seed("cartX", OTHER_CLINIC);

    // A cart in another clinic is never reservable from CLINIC's list.
    const noCart = await reserveNearestReadyCart(store, CLINIC, "sess-1", ["cartX"]);
    expect(noCart).toEqual<SoftReserveResult>({ reserved: false, reason: "no_cart_available" });
    expect(store.reservedOf("cartX")).toBeNull();

    // Reserve in each clinic under the same session id; clear must not cross clinics.
    await reserveNearestReadyCart(store, CLINIC, "shared-sess", ["cartA"]);
    store.carts.get("cartX")!.reservedForSessionId = "shared-sess";
    await clearReservationForSession(store, CLINIC, "shared-sess");
    expect(store.reservedOf("cartA")).toBeNull();
    expect(store.reservedOf("cartX")).toBe("shared-sess");
  });
});

describe("R-CBF-1.2 · DrizzleCartReservationStore issues the CAS-guarded SQL", () => {
  it("compareAndReserve UPDATEs only reservedForSessionId and returns true iff a row was updated", async () => {
    const setArgs: unknown[] = [];
    let returned: Array<{ id: string }> = [{ id: "cartA" }];
    const executor = {
      update() {
        return {
          set(values: unknown) {
            setArgs.push(values);
            return {
              where() {
                return { returning: async () => returned };
              },
            };
          },
        };
      },
    };

    const store = new DrizzleCartReservationStore(executor as never);
    const won = await store.compareAndReserve(CLINIC, "cartA", "sess-1");
    expect(won).toBe(true);
    // Only the additive hint column is written — custody-toggle semantics untouched.
    expect(setArgs).toEqual([{ reservedForSessionId: "sess-1" }]);

    returned = [];
    const lost = await store.compareAndReserve(CLINIC, "cartA", "sess-2");
    expect(lost).toBe(false);
  });

  it("clearBySession sets reservedForSessionId back to NULL", async () => {
    const setArgs: unknown[] = [];
    const executor = {
      update() {
        return {
          set(values: unknown) {
            setArgs.push(values);
            return { where: async () => undefined };
          },
        };
      },
    };
    const store = new DrizzleCartReservationStore(executor as never);
    await store.clearBySession(CLINIC, "sess-1");
    expect(setArgs).toEqual([{ reservedForSessionId: null }]);
  });
});

describe("R-CBF-1.2 · additive schema + migration", () => {
  it("vt_equipment exposes the additive reservedForSessionId column", () => {
    expect(equipment.reservedForSessionId).toBeDefined();
  });

  it("the Drizzle store guards the CAS with `reservedForSessionId IS NULL` and clears scoped by session id", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "server/lib/code-blue-soft-reserve.ts"),
      "utf8",
    );
    // Compare-and-set: reserve only where the column is currently NULL.
    expect(source).toContain("isNull(equipment.reservedForSessionId)");
    // Cleanup: clear only rows equal to THIS session id (never another session's).
    expect(source).toContain("eq(equipment.reservedForSessionId, sessionId)");
    // Clinic-scoped on every path.
    expect(source).toContain("eq(equipment.clinicId, clinicId)");
  });

  it("ships a hand-authored additive migration for the new column", () => {
    const dir = path.join(process.cwd(), "migrations");
    const file = fs
      .readdirSync(dir)
      .find((f) => f.endsWith(".sql") && f.includes("reserved_for_session"));
    expect(file, "migration adding reserved_for_session_id must exist").toBeTruthy();
    const sql = fs.readFileSync(path.join(dir, file as string), "utf8");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS reserved_for_session_id/);
  });
});
