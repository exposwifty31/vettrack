import AppIntents
import UIKit

@available(iOS 18.0, *)
struct OpenScanIntent: AppIntent {
    static let title: LocalizedStringResource = "Scan Equipment"
    static let openAppWhenRun: Bool = true
    @MainActor
    func perform() async throws -> some IntentResult {
        if let url = URL(string: "vettrack://scan") { await UIApplication.shared.open(url) }
        return .result()
    }
}
