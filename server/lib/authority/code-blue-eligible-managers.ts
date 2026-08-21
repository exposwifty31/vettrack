/**
 * Code Blue eligible-manager discovery — the list behind
 * `GET /api/code-blue/eligible-managers`.
 *
 * DISCOVERY ONLY. This module grants nothing and gates nothing. The enforcement
 * boundary stays where it is: `POST /api/code-blue/sessions` and
 * `POST /api/code-blue/one-tap` (`server/routes/code-blue.ts:330`, `:567`).
 *
 * The one invariant that matters here: **the list cannot disagree with the POST.**
 * Offering a manager the POST will reject with 403 MANAGER_NOT_CODE_BLUE_ELIGIBLE
 * — during a cardiac arrest — is worse than offering no list at all. So this runs
 * the same evaluator (`evaluateCodeBlueManagerAuthority`) over the same lookup
 * (`loadCodeBlueManagerLookup`) that the POSTs run, rather than reimplementing the
 * predicate. `tests/code-blue-eligible-managers.service.test.ts` pins the
 * agreement against `evaluateCodeBlueManagerForRoute` itself.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db, users } from "../../db.js";
import type { CodeBlueEligibleManager } from "@vettrack/contracts";
import {
  loadCodeBlueManagerLookup,
} from "./code-blue-manager.wiring.js";
import { evaluateCodeBlueManagerAuthority } from "./enforcement/code-blue-manager.evaluator.js";
import { resolveCodeBlueManagerEnforcementMode } from "./enforcement/config.js";
import type { CodeBlueManagerEndpoint } from "./enforcement/code-blue-manager.types.js";

/**
 * Eligibility is asked as the initiation question, because initiation is what the
 * list feeds. Asking `"end"` here would answer a different question and reintroduce
 * the drift this module exists to remove.
 */
const DISCOVERY_ENDPOINT: CodeBlueManagerEndpoint = "initiation";

export interface ListCodeBlueEligibleManagersInput {
  clinicId: string;
  now?: Date;
}

type ManagerCandidate = { id: string; name: string; role: string };

function toEligibleManager(candidate: ManagerCandidate): CodeBlueEligibleManager {
  return { userId: candidate.id, name: candidate.name, role: candidate.role };
}

/**
 * The candidate set: active vets/admins in this clinic.
 *
 * Mirrors the POST's manager-validation query (`server/routes/code-blue.ts:362-373`)
 * field for field — clinic, role, status — INCLUDING its absence of a `deleted_at`
 * filter. That absence is deliberate here, not an oversight: this list must be
 * one-for-one with what the POST accepts, and adding a filter the POST does not
 * apply would make the list stricter than the gate it feeds. (The asymmetry between
 * that query and `loadCodeBlueManagerLookup`, which does treat soft-deleted users as
 * missing, is pre-existing and out of scope here.)
 */
async function loadManagerCandidates(clinicId: string): Promise<ManagerCandidate[]> {
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.clinicId, clinicId),
        inArray(users.role, ["vet", "admin"]),
        eq(users.status, "active"),
      ),
    )
    .orderBy(users.name);
}

export async function listCodeBlueEligibleManagers(
  input: ListCodeBlueEligibleManagersInput,
): Promise<CodeBlueEligibleManager[]> {
  const now = input.now ?? new Date();
  const candidates = await loadManagerCandidates(input.clinicId);

  // Resolved ONCE for the whole sweep. Per-candidate resolution would let the
  // 10s config TTL flip mid-list and return a half-off / half-enforce answer —
  // a list that matches no single version of the gate.
  const mode = await resolveCodeBlueManagerEnforcementMode(
    input.clinicId,
    DISCOVERY_ENDPOINT,
  );

  // `off` is every active vet/admin, explicitly and by construction — exactly
  // what the POST accepts in this mode, since the evaluator short-circuits to
  // `allow: MODE_OFF` before it looks at the manager at all. Returning early also
  // honours the wiring contract that `off` issues no clinical-validation queries;
  // running the loop would fire one authority resolve per vet for a verdict that
  // is already determined.
  if (mode === "off") {
    return candidates.map(toEligibleManager);
  }

  const pinnedMode = async () => mode;

  // Concurrent, not sequential: this is a read on an emergency path, and serial
  // round-trips would multiply its latency by the size of the clinic's roster.
  // The fan-out is bounded by the active vets/admins of ONE clinic.
  const verdicts = await Promise.all(
    candidates.map(async (candidate) => {
      const lookup = await loadCodeBlueManagerLookup({
        clinicId: input.clinicId,
        managerUserId: candidate.id,
        now,
      });
      return evaluateCodeBlueManagerAuthority(
        {
          clinicId: input.clinicId,
          now,
          endpoint: DISCOVERY_ENDPOINT,
          managerUserId: candidate.id,
          lookup,
        },
        {
          modeResolver: pinnedMode,
          // A read must not vote in the rollout signal. See the flag's own
          // contract in code-blue-manager.evaluator.ts.
          observe: false,
        },
      );
    }),
  );

  return candidates
    .filter((_candidate, index) => verdicts[index].action === "allow")
    .map(toEligibleManager);
}
