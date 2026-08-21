/**
 * Shared Code Blue contract types.
 *
 * Consumed by this repo's server + web client and by the React Native migration
 * repo, which vendors this package (`npm run vendor:vettrack` there). A change
 * here needs a companion re-vendor.
 */

/**
 * One candidate returned by `GET /api/code-blue/eligible-managers`.
 *
 * `role` is `string` rather than a `"vet" | "admin"` union because `vt_users.role`
 * is a varchar, not a pg enum — the narrower type would be a cast asserting
 * something the schema does not guarantee. Callers that need the narrow set
 * should narrow explicitly.
 */
export interface CodeBlueEligibleManager {
  userId: string;
  name: string;
  role: string;
}

/**
 * Response body of `GET /api/code-blue/eligible-managers`.
 *
 * DISCOVERY ONLY. The list answers "who would the Code Blue manager check accept
 * right now" and grants nothing; `POST /api/code-blue/sessions` and
 * `POST /api/code-blue/one-tap` remain the enforcement boundary. It is built by
 * running the same evaluator those routes run, so the two cannot disagree.
 */
export interface CodeBlueEligibleManagersResponse {
  managers: CodeBlueEligibleManager[];
}
