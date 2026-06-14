import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // Quick-action / Control scan shortcut type. Mirrors UIApplicationShortcutItems in Info.plist
    // and the Control's vettrack://scan target.
    private static let scanShortcutType = "uk.vettrack.app.scan"
    // Set at cold launch when the app is started BY the scan shortcut; consumed once the Capacitor
    // bridge is loaded in applicationDidBecomeActive.
    private var pendingScanShortcut = false

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // COLD launch via a Home Screen quick action: the shortcut is not a URL, so getLaunchUrl()
        // cannot capture it. Flag it and replay a synthesized vettrack://scan open once the bridge is
        // ready (see fireScanWhenBridgeReady).
        if let shortcut = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem,
           shortcut.type == AppDelegate.scanShortcutType {
            pendingScanShortcut = true
        }
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
        // Drain a cold-launch scan shortcut (no-op if none is pending).
        fireScanWhenBridgeReady()
    }

    // WARM launch: app already running when the quick action is triggered. The bridge is loaded, so
    // synthesize a single vettrack://scan open through the same ApplicationDelegateProxy path that
    // already delivers Universal Links and OAuth callbacks; the JS deep-link router handles it.
    func application(
        _ application: UIApplication,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        guard shortcutItem.type == AppDelegate.scanShortcutType,
              let url = URL(string: "vettrack://scan") else {
            completionHandler(false)
            return
        }
        _ = ApplicationDelegateProxy.shared.application(application, open: url, options: [:])
        completionHandler(true)
    }

    // The Capacitor bridge is loaded once the storyboard root VC (CAPBridgeViewController) has a
    // non-nil bridge. D4: the exit condition is bridge-loaded, NOT the proxy return value —
    // @capacitor/app fires appUrlOpen with retainUntilConsumed:true, so the synthesized open is
    // queued and replayed to the router's JS listener whenever it registers. Bounded retry (~5s).
    private func bridgeIsLoaded() -> Bool {
        return (window?.rootViewController as? CAPBridgeViewController)?.bridge != nil
    }

    private func fireScanWhenBridgeReady(attempt: Int = 0) {
        guard pendingScanShortcut else { return }
        let maxAttempts = 20 // ~5s at 250ms — generous cold-start headroom
        guard bridgeIsLoaded() else {
            if attempt < maxAttempts {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                    self?.fireScanWhenBridgeReady(attempt: attempt + 1)
                }
            }
            return
        }
        guard let url = URL(string: "vettrack://scan") else { return }
        pendingScanShortcut = false
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
