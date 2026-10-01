// swift-tools-version: 5.9
import PackageDescription

// 只验证平台无关的 HTTP 模型、孩子隔离和输入合同；SwiftUI 继续由 Xcode 构建。
let package = Package(
    name: "MathinParentCore",
    platforms: [.macOS(.v13)],
    products: [.library(name: "ParentCore", targets: ["ParentCore"])],
    targets: [
        .target(name: "ParentCore", path: "MathinParent/Core"),
        .testTarget(name: "ParentCoreTests", dependencies: ["ParentCore"], path: "Tests")
    ]
)
