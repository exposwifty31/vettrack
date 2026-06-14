import AppIntents
import SwiftUI

@available(iOS 18.0, *)
struct OpenScanIntent: AppIntent {
    static let title: LocalizedStringResource = "Scan Equipment"
    static let openAppWhenRun: Bool = true

    @Environment(\.openURL) private var openURL

    @MainActor
    func perform() async throws -> some IntentResult {
        if let url = URL(string: "vettrack://scan") {
            openURL(url)
        }
        return .result()
    }
}
