// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "RemoteAgentNotch",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "RemoteAgentNotch",
            path: "Sources/RemoteAgentNotch"
        )
    ]
)
