# Mathin 原生家长端

本目录与现有 Next.js 网页处于同一个 Git 仓库。微信、iOS 和 Android 独立构建、独立发布，共用现有服务、账号和数据。

当前交付为工程基础：四个可切换入口“课程、错题、作业、我的”，中英文文案，跟随系统的浅色/深色主题。各页面明确显示功能准备中，不加载业务数据、不发起登录或网络请求。品牌字体、业务界面及真实账号接入属于后续增量；本轮不改变 R1-Live 阶段或生产状态。

## 开发入口

| 工程 | 工具 / 最低运行版本 | 操作 |
| --- | --- | --- |
| [微信小程序](parent-wechat/README.md) | 微信开发者工具，原生 TypeScript | 导入 `apps/parent-wechat` |
| [iOS](parent-ios/README.md) | Xcode 16+，iOS 17+ | 打开 `MathinParent.xcodeproj` |
| [Android](parent-android/README.md) | Android Studio，Java 17+，Android 8+ | 打开 `apps/parent-android` |

在仓库根目录安装 JavaScript 依赖并检查：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm parents:check
corepack pnpm parents:doctor
```

`pnpm dev`、`pnpm build`、`pnpm typecheck` 和 `pnpm lint` 继续服务网页。根 TypeScript、ESLint 和 Tailwind 已隔离 apps；Vitest 的默认范围仍为 tests。pnpm workspace 只管理微信工程的 JavaScript 工具，Swift 和 Kotlin 依赖分别交给 Xcode、Gradle。

## 接口与环境

接口权威入口为 [parent-api](../contracts/parent-api/README.md)。本轮只登记现有只读健康接口，不增加数据库或业务 API。

未来本机联调使用开发服务；人工验收网页入口为 `http://192.168.5.213:3130`。手机访问电脑时使用局域网地址；模拟器的 localhost 指向模拟器自身。

微信 AppID、Apple Team/Bundle ID、Android applicationId 和签名在各端发布前按实际开发者账号配置。现有 Bundle/application ID 是工程暂定标识，不代表已完成平台注册。三个平台的本机配置、签名和构建输出均加入 Git 忽略。

## 验证范围

- `parents:check`：工程配置、接口与翻译一致性、微信 TypeScript、网页类型边界。
- Android：`gradlew :app:assembleDebug :app:lintDebug`，产出可安装调试包。
- iOS：`xcodebuild` 共享 scheme 的无签名模拟器构建。
- [独立 CI](../.github/workflows/parent-clients.yml) 根据相关路径触发，执行静态检查、Android 和 iOS 构建。提交 workflow 不代表已执行成功。

构建通过后仍需产品负责人在微信工具、手机或模拟器中验收四个入口、中文/英文与浅色/深色。当前工程不提供正式登录、选课、错题读取或作业提交。

### 2026-09-21 本轮检查结果

- 家长端窄检查、微信 TypeScript、定向测试和受影响 ESLint 通过；网页 TypeScript 与 Tailwind 样式编译通过。
- Android 的 Debug 构建和 Lint 通过，已生成 `parent-android/app/build/outputs/apk/debug/app-debug.apk`。Lint 保留工具链更新及数据提取规则建议，当前外壳没有账号或本地业务数据。
- iOS 的 Xcode 项目语法、对象引用、Info.plist、资源与 scheme 已做静态核对；当前 Windows 主机未执行 SwiftUI 编译。
- 微信开发者工具、Android 真机/模拟器及 iOS 的人工体验验收待进行；独立 CI 已配置，尚未推送运行。
