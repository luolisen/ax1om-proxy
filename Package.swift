// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "AX1OM", platforms: [.macOS(.v14)], products: [.executable(name: "AX1OM", targets: ["AX1OM"])], targets: [.executableTarget(name: "AX1OM", resources: [.copy("Resources")]), .testTarget(name: "AX1OMTests", dependencies: ["AX1OM"])])
