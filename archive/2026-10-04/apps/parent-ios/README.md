# iOS 原生家长端

> 2026-10-03 状态核对：四页签、真实数据、设置与二级页已集成，V6 开发包已交付；V6 设备编译、会话、登录及视觉仍待用户验收。V5 可运行确认限定于旧包。共用后端及报告身份迁移已随 v0.3.0 发布；客户端正式安装／TestFlight／上架另行办理。当前状态见 [doc 25](../../docs/plan/25-production-1.0-product-completeness.md#current-facts)与[V6 任务](../../.ai/tasks/DEV-PARENT-IOS-DETAILS-20261002.md)。

Swift + SwiftUI，最低 iOS 17，使用 Xcode 16 或更新版本。此增量把离线外壳扩展为消息、课程、任务、家长四个原生页签，按参考截图的淡紫色、圆角卡片、孩子切换和入口层级组织。中英文、深浅外观及系统字号共用原生组件。

## 在 Mac 上查看

1. 打开 `MathinParent.xcodeproj`，选择共享 scheme `MathinParent` 和 iOS 模拟器。
2. 直接运行后，点击“预览界面”。预览使用虚构的两个孩子及演示课程，独立提示预览状态，作业提交和请假按钮禁用；不连接数据库。
3. 查看消息、课程与月历、报告、任务详情、孩子切换和家长服务。返回登录页后可按下节接入真实服务。
4. 真机运行时，在 Signing & Capabilities 选择开发团队；按账号情况设置 Bundle ID。

Debug 使用 `club.mathin.parent.dev`，Release 使用 `club.mathin.parent`，均为暂定标识。品牌图标、签名、TestFlight 与上架属于后续发布增量。

## 在 iPad Swift Playgrounds 上查看

使用 iPad 上已经确认能运行的原生 `.swiftpm` 空白工程作为模板。导出器保留模板的产品名、最低系统版本、图标、`MyApp.swift` 入口和工作区元数据；因此输出工程的最低版本以模板为准。原始模板与旧副本保留。

在受控本机环境中设置 `MATHIN_API_ORIGIN` 为开发服务 origin，然后运行：

```sh
node apps/parent-ios/scripts/export-playground.mjs --template /path/to/native.swiftpm --output /path/to/new-folder
```

输出目录内的工程可直接复制到“我的 iPad”，在 Swift Playgrounds 中打开并点击运行。进入欢迎页后使用已有开发家长账号登录；“预览界面”仍是单独的离线示例入口。工程中没有预置账号或会话。局域网模式需要两端网络可互通，并允许本地网络访问。

导出器只增加开发网络 plist、对应 manifest 引用和 `DEBUG` 标记；HTTP 例外仅指定当前主机，HTTPS 保留系统默认传输限制。manifest 修改后让 Playgrounds 重建缓存。文案直接写入生成的 Swift 字典，延续 V5 已运行的无资源 bundle 方式。导出目录必须不存在，避免覆盖正在使用的版本。

设置页采用参考图的分组列表。账号安全与第三方账号绑定打开现有账号中心并重新登录；权限可打开系统设置；消息开关控制应用内角标；清理缓存只清本机网络缓存。问题反馈可填写文字、选择最多三张图片并主动分享，在线接收与记录尚未开通。信箱提供实际教师联系入口。

导出检查：`node apps/parent-ios/scripts/export-playground.test.mjs`。Windows 上通过静态与导出检查后，仍需在 iPad 确认新包编译、真实登录、数据和页面效果。原 V5 编译成功与新版通过是两个状态。

## 连接现有账号与数据

复制 `Config/Local.example.xcconfig` 为同目录被忽略的 `Local.xcconfig`，在本机填写：

```xcconfig
MATHIN_API_ORIGIN = http:/$()/192.168.5.213:3130
MATHIN_DEV_HTTP_HOST = 192.168.5.213
```

`xcconfig` 会把双斜线解释为注释，URL 中的 `$()` 用于保留双斜线。iPhone 与开发主机需位于可互通的局域网，首次连接时允许本地网络访问。该文件只由 Debug 引入；Release 通过构建设置显式提供 HTTPS 的 `MATHIN_API_ORIGIN`。留空时仍可预览，登录页会显示配置说明。

Debug 的传输例外仅用于 `MATHIN_DEV_HTTP_HOST` 指定的主机；客户端同时限制 HTTP 为回环或私有 IPv4 地址。Release 使用无 HTTP 例外的 `Info.plist`，并在代码中要求 HTTPS。iOS 17 的 IP 例外依据 [Apple NSAllowsLocalNetworking](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking) 与 [NSExceptionDomains](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsexceptiondomains)。

使用已建立亲子关系的开发家长账号登录。客户端通过现有 Next.js 版本化接口访问 Supabase；服务端检查账号、亲子关系和 RLS。会话按 origin 存入设备 Keychain，退出清除本机会话；请求关闭重定向，令牌不进入 URL 或日志。

本次没有新建数据表。同步接口与依赖：

- `POST /api/v1/parent/auth`：登录、刷新、退出。
- `GET /api/v1/parent/portal`：家长账号、作业与已提交内容。
- `GET/POST /api/v1/parent/learning`：按孩子读取课程、课表、通知、报告与请假记录；登记请假和已读通知。
- `POST/GET /api/v1/parent/media`：上传所选作业图片、获取受保护附件访问地址。
- `POST /api/v1/parent/portal`：提交作业，重试保留同一提交 ID；照片或文字变更后开始新提交。

共用合同见 [`contracts/parent-api`](../../contracts/parent-api/README.md)，后台能力映射见 [`parent-ios-data-map.md`](../../docs/evidence/parent-ios-data-map.md)。测评报告兼容迁移 `20261001000100_parent_report_participant_identity.sql` 补充稳定孩子 ID，已在本机安装，并随[v0.3.0 发布](../../docs/evidence/r1/release-v030-20261002.md)应用生产。其他未升级环境的无 ID 报告继续明确提示暂不可按孩子展示，避免同名混读；该兼容行为与目标环境升级状态分别记录。

## 本轮功能与验收

| 页面 | 已接入行为 |
| --- | --- |
| 消息 | 通知分组、搜索、未读筛选、详情与已读；从实际课程显示教师联系人 |
| 课程 | 周课表、按月加载日历、课程列表与课次详情、课堂反馈／测评报告、星星及出勤概况 |
| 任务 | 待完成／已提交筛选、详情与系统分享、选取最多 9 张图片、压缩上传、说明及提交记录 |
| 家长 | 绑定孩子查看与切换、请假及处理状态、服务入口、设置与退出 |

对话、通话、错题、跟读打卡、调课、转班、物流、地址编辑、邀请、支付等入口展示明确的能力状态及教师联系路径。参考产品的这些业务没有对应现有接口，本轮不生成虚假成功、课时余额、交易记录或通话。课程数量表示查询窗口内已排课节数；不作为购课或余额。

人工验收重点：两个孩子之间切换后详情和草稿重置；中文／英文及大字号布局；月历翻月后主页课表保留；登录错误与网络失败显示；真实作业提交后读取服务端记录；请假响应不确定时先刷新记录再确认新请求。照片通过系统选择器按张授权，不读取整个相册，不申请相机权限。

## 检查与当前状态

在仓库根目录运行：

```sh
node apps/parent-ios/scripts/check.mjs
swift test --package-path apps/parent-ios
xcodebuild -project apps/parent-ios/MathinParent.xcodeproj -scheme MathinParent \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath apps/parent-ios/build CODE_SIGNING_ALLOWED=NO build
```

`Parent clients` CI 已接入 Swift 核心合同测试和 Xcode 模拟器构建。静态检查验证源文件、Xcode 资源、本地化及配置；Swift 测试覆盖孩子隔离、旧报告、输入长度、提交不确定状态和月份日期。静态检查不能替代 SwiftUI 编译。

2026-10-01：Windows 上原生工程静态检查通过，共享 API 定向测试和双向复核通过。此环境没有 Swift/Xcode，Swift 测试、Xcode 构建、模拟器与真机人工验收待 Mac 执行；CI 尚未取得运行结果。报告身份增量已在本机安装并通过 HTTP 兼容读取检查；未操作生产。
