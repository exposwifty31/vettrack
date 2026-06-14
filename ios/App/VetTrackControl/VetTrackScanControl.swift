import AppIntents
import SwiftUI
import WidgetKit

@available(iOS 18.0, *)
struct VetTrackScanControl: ControlWidget {
    static let kind = "uk.vettrack.app.control.scan"
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenScanIntent()) {
                Label("Scan Equipment", systemImage: "sensor.tag.radiowaves.forward")
            }
        }
        .displayName("Scan Equipment")
        .description("Open VetTrack and scan an equipment tag.")
    }
}
