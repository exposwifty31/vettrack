/**
 * WebdriverIO + Appium (XCUITest) config for the Phase-10 III.6 NATIVE flow walk.
 *
 * Drives the Capacitor iOS shell in the Simulator, switches into its WKWebView
 * context, and asserts the manifest's `expectedNativeOutcome` for each row. This is
 * where the mobile-target guards actually fire (CustodyGuard redirect, WebOnlyGuard
 * → /home) — the desktop management-web gate (T-31) never applies here.
 *
 * Prerequisites (see ./README.md):
 *   1. Sync + run the dev-bypass live-reload shell against a LOCAL server (repo root):
 *        CAPACITOR_SERVER_URL=http://localhost:5000 npx cap sync ios
 *        CAPACITOR_SERVER_URL=http://localhost:5000 npx cap run ios --target <sim-udid>
 *      Do NOT use pnpm cap:build:native for this — build-native-shell.sh deliberately
 *      strips CAPACITOR_SERVER_URL (App Review 4.2), producing a bundled shell.
 *   2. `cd tests/flow-walk/native && pnpm install` (isolated — not part of root install).
 *   3. Boot a simulator; export APP_PATH (the built .app) or BUNDLE_ID (installed app).
 *
 * Run:  pnpm walk:iphone   /   pnpm walk:ipad
 */
import type { Options } from "@wdio/types";

const DEVICE = process.env.DEVICE === "ipad" ? "ipad" : "iphone";
const DEVICE_NAME =
  process.env.SIM_DEVICE_NAME ?? (DEVICE === "ipad" ? "iPad Pro 11-inch (M5)" : "iPhone 17");
// Omit platformVersion unless pinned — XCUITest then matches the named device's own
// runtime, so the conf doesn't rot every time Xcode ships a new iOS (17.5 was already
// uninstallable on the authoring machine, which only had 26.x runtimes).
const PLATFORM_VERSION = process.env.SIM_PLATFORM_VERSION;
// Pin the exact simulator when device names are ambiguous (the same device name
// can exist under several installed runtimes): xcrun simctl list devices booted
const SIM_UDID = process.env.SIM_UDID;
const BUNDLE_ID = process.env.BUNDLE_ID ?? "uk.vettrack.app";
const APP_PATH = process.env.APP_PATH; // optional: install a fresh .app instead of using BUNDLE_ID

export const config: Options.Testrunner = {
  runner: "local",
  autoCompileOpts: {
    autoCompile: true,
    tsNodeOpts: { project: "./tsconfig.json", transpileOnly: true },
  },
  specs: ["./native-walk.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      "appium:deviceName": DEVICE_NAME,
      ...(PLATFORM_VERSION ? { "appium:platformVersion": PLATFORM_VERSION } : {}),
      ...(SIM_UDID ? { "appium:udid": SIM_UDID } : {}),
      ...(APP_PATH ? { "appium:app": APP_PATH } : { "appium:bundleId": BUNDLE_ID }),
      // Phase-0b permission prompts (camera/NFC/notifications) — auto-accept so the
      // walk is not blocked by a system alert. Mirrors the branch this work lives on.
      "appium:autoAcceptAlerts": true,
      "appium:webviewConnectTimeout": 30_000,
      // Capacitor's WKWebView reports as the app's own webview; let WDIO detect it.
      "appium:includeSafariInWebviews": false,
      "appium:newCommandTimeout": 240,
    },
  ],
  logLevel: "info",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 180_000 },
  services: [
    [
      "appium",
      {
        args: { address: "127.0.0.1", port: 4723 },
        command: "appium",
      },
    ],
  ],
  port: 4723,
};
