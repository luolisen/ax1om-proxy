import SwiftUI
import AppKit

struct BrandMark: View {
    var menuBar = false
    private var image: NSImage? {
        let packaged = Bundle.main.resourceURL?.appendingPathComponent("AX1OM_AX1OM.bundle/Resources/ax1om-monogram.png")
        var url = packaged.flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil }
        #if DEBUG
        url = url ?? Bundle.module.url(forResource: "ax1om-monogram", withExtension: "png", subdirectory: "Resources")
        #endif
        return url.flatMap { NSImage(contentsOf: $0) }
    }
    var body: some View {
        if let image {
            Image(nsImage: image).resizable().renderingMode(menuBar ? .template : .original).scaledToFit()
                .background(menuBar ? Color.clear : Color.white, in: RoundedRectangle(cornerRadius: 11))
                .accessibilityLabel("AX1OM 几何徽标")
        }
    }
}
