import Foundation
import Capacitor
import UIKit

/**
 * Exposes the iOS Dynamic Type setting (`preferredContentSizeCategory`) to the
 * web layer as a numeric scale, so the app can seed its `--type-scale` text
 * multiplier from the OS accessibility preference.
 *
 * OWED / NOT YET WIRED: this file must be added to the `App` target in Xcode
 * (project.pbxproj → Build Phases → Compile Sources) before it compiles and
 * auto-registers with Capacitor. Until then the JS bridge
 * (`src/lib/dynamic-type.ts`) resolves to null and the app uses the in-app
 * "Text size" setting. Verify with `pnpm cap:build:native` on a simulator/device.
 */
@objc(DynamicTypePlugin)
public class DynamicTypePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DynamicTypePlugin"
    public let jsName = "DynamicType"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getScale", returnType: CAPPluginReturnPromise)
    ]

    @objc func getScale(_ call: CAPPluginCall) {
        let category = UIApplication.shared.preferredContentSizeCategory
        call.resolve(["scale": DynamicTypePlugin.scale(for: category)])
    }

    /** Map a UIContentSizeCategory to the same bucketed multipliers the web uses. */
    private static func scale(for category: UIContentSizeCategory) -> Double {
        switch category {
        case .extraSmall: return 0.82
        case .small: return 0.88
        case .medium: return 0.94
        case .large: return 1.0
        case .extraLarge: return 1.12
        case .extraExtraLarge: return 1.24
        case .extraExtraExtraLarge: return 1.35
        case .accessibilityMedium,
             .accessibilityLarge,
             .accessibilityExtraLarge,
             .accessibilityExtraExtraLarge,
             .accessibilityExtraExtraExtraLarge:
            return 1.5
        default:
            return 1.0
        }
    }
}
