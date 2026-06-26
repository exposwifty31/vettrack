/**
 * Infrastructure barrel — prefer importing from subdirectories for tree-shaking.
 * This re-exports the most-used platform singletons for convenience.
 */
export { haptics, nfc, deepLink } from "./platform";
export { equipmentCache, syncQueue } from "./db";
