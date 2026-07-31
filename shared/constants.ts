// Shared constants used by both server and client code.
// Changes here automatically apply to both analytics routes and utility functions.

/** Number of days since last scan after which equipment is considered inactive. */
export const INACTIVE_THRESHOLD_DAYS = 14;

/**
 * Android application id of the native shell. Single source of truth for the two
 * places it must agree: the Digital Asset Links statement served at
 * `/.well-known/assetlinks.json` and the AAR record written onto NFC stickers.
 * A divergence would silently break "tap a sticker on a phone without the app".
 */
export const ANDROID_APP_PACKAGE = "uk.vettrack.app";
