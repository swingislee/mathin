# iOS 原生家长端

使用 Swift + SwiftUI，最低 iOS 17；工程可以直接用 Xcode 16 或更新版本打开。

1. 在 Mac 上打开 `MathinParent.xcodeproj`。
2. 选择共享 scheme `MathinParent` 和一个 iOS 模拟器，运行。
3. 真机调试时，在 Signing & Capabilities 选择自己的开发团队；按账号情况设置 Bundle ID。

无签名模拟器构建：

```sh
xcodebuild -project MathinParent.xcodeproj -scheme MathinParent \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

Debug 使用 `club.mathin.parent.dev`，Release 使用 `club.mathin.parent`；均为暂定标识。Debug 本机配置可复制 `Config/Local.example.xcconfig` 为 `Config/Local.xcconfig`。Release 独立配置，发布签名单独设置。

文案使用 zh-Hans/en 本地化资源，外观跟随系统。工程当前离线运行，不读取 API origin、不申请相机或照片权限；这些能力随真实功能接入。系统品牌图标与上架资源在发布增量中补齐。

Windows 可编辑源码和检查项目引用；SwiftUI 编译与模拟器验证在 Mac/Xcode 执行。
