import SwiftUI
import WidgetKit

@main
struct VetTrackControlBundle: WidgetBundle {
    @WidgetBundleBuilder
    var body: some Widget {
        if #available(iOS 18.0, *) { VetTrackScanControl() }
    }
}
