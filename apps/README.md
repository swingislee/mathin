# Mathin 原生家长端

本目录与现有 Next.js 网页处于同一个 Git 仓库。微信、iOS 和 Android 独立构建、独立发布，共用现有服务、账号和数据。

2026-10-03 核对：小程序与 iOS 已从工程外壳推进到账号和业务数据接入，Android 仍为离线工程外壳。共用网站后端已随 v0.3.0 发布；各客户端的设备验收、微信平台配置与正式发布分别办理。已实现、已部署、待验收、已验收的统一记录见 [当前状态](../docs/current.md)。

| 工程 | 当前实现 | 开发运行与机器证据 | 待人工验收／发布 |
| --- | --- | --- | --- |
| 微信小程序 | “发现、课程、家长”三栏，账号／孩子、登记、活动、测评、课表、结果与练习 | 固定开发数据、真实 HTTP 和原生模拟器读取通过；微信登录／绑定代码已集成 | 业务与手机体验、配置后的真实微信往返、客户端平台发布 |
| iOS | “消息、课程、任务、家长”四页签，账号、报告、作业图片、请假、设置与二级页 | V6 代码、静态和导出检查已交付；用户确认过 V5 可运行 | V6 设备编译、Keychain、真实登录与数据、视觉；Xcode／TestFlight／上架分别验证 |
| Android | “课程、错题、作业、我的”离线外壳，双语和系统主题 | 9 月 21 日 Debug 构建与 Lint 通过 | 外壳设备体验；真实业务接入尚待选入开发 |

小程序依据见[开发集成记录](../archive/2026-10-04/.ai/tasks/DEV-PARENT-PREVIEW-20261002-INTEGRATION.md)，iOS 依据见[V6 接收记录](../archive/2026-10-04/.ai/tasks/DEV-PARENT-IOS-DETAILS-20261002.md)，后端生产范围见[v0.3.0 发布](../archive/2026-10-04/docs/evidence/r1/release-v030-20261002.md)。旧包可运行与新包人工验收分别记录。

## 开发入口

| 工程 | 工具 / 最低运行版本 | 操作 |
| --- | --- | --- |
| [微信小程序](parent-wechat/README.md) | 微信开发者工具，原生 TypeScript | 导入 `apps/parent-wechat` |
| [iOS](parent-ios/README.md) | Xcode 16+，iOS 17+ | 打开 `MathinParent.xcodeproj` |
| [Android](parent-android/README.md) | Android Studio，Java 17+，Android 8+ | 打开 `apps/parent-android` |

在仓库根目录安装依赖；需要排查平台工具链时使用 doctor：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm parents:doctor
```

`pnpm dev`、`pnpm build`、`pnpm typecheck` 和 `pnpm lint` 继续服务网页。根 TypeScript、ESLint 和 Tailwind 已隔离 apps；Vitest 的默认范围仍为 tests。pnpm workspace 只管理微信工程的 JavaScript 工具，Swift 和 Kotlin 依赖分别交给 Xcode、Gradle。

## 接口与环境

接口权威入口为 [parent-api](../contracts/parent-api/README.md)。现有版本化接口覆盖账号、门户、学习视图、作业媒体、通知、请假与测评申请／确认；各客户端只使用已登记能力。生产 API 及家长相关迁移已经发布，完整家庭业务闭环继续待验收。

本机联调使用既有开发服务；人工验收网页入口为 `http://192.168.5.213:3130`。手机访问电脑时使用局域网地址；模拟器的 localhost 指向模拟器自身。各端 origin 从被忽略的本机配置读取，生产发布另行选择正式 HTTPS 目标。

微信 AppID、Apple Team/Bundle ID、Android applicationId 和签名在各端发布前按实际开发者账号配置。现有 Bundle/application ID 是工程暂定标识，不代表已完成平台注册。三个平台的本机配置、签名和构建输出均加入 Git 忽略。

## 构建与使用

需要交付时，Android 使用 `gradlew :app:assembleDebug`，iOS 使用共享 scheme 的 Xcode 构建，小程序使用开发者工具编译。各端具体操作见对应 README。

[客户端构建](../.github/workflows/parent-clients.yml) 按需要手动选择 iOS 或 Android，不随普通提交运行。平台运行、业务与视觉由产品负责人实际确认，状态见 [当前状态](../docs/current.md)。
