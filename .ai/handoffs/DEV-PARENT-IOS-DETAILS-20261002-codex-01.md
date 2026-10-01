# DEV-PARENT-IOS-DETAILS-20261002 · Codex 第 01 次交接

- 发出方 / 接收方：iOS 原会话 `01a0f814-c4aa-73c0-8e9b-93481aa86ac2` / 当前集成人 `01a0f7b2-73aa-74b3-8cf6-b23207ece7d6`。
- 目的：客户端增量交付，申请只读复核与集成。
- 任务卡：`main:.ai/tasks/DEV-PARENT-IOS-DETAILS-20261002.md`。
- 代码 base：`8365ed7b0125091e790db89ab5dfca78daa3164e`；代码 head：`9d178dce1ad99ae298f37b1abf3cefb31c084055`。
- 分支：`codex/parent-ios-details-codex`；本会话附属 worktree 名称为 `parent-ios-details-codex`。精确路径以 `git worktree list` 为准。

## 改变的行为

- 设置页按原始参考图的分组列表组织：账号与安全、消息提醒、权限、缓存、关于、问题反馈、隐私与退出。账号值使用实际显示名，缓存值来自本机 URLCache，版本来自 Bundle；不虚构手机号、缓存量或发布版本。
- 账号与安全和第三方绑定入口打开现有网页账号中心；网页登录独立完成。权限页说明当前照片选择、本地网络和应用内角标的行为，并可进入系统设置。隐私入口复用当前服务的政策页。
- 问题反馈支持类型、最多 1000 UTF-16 单元文字、三张系统选择的图片和主动分享。图片限制 12 MB 并缩略到 1600 像素，减少内存占用。在线反馈/信箱没有后端接收合同，页面准确说明状态，提供教师联系入口。
- 消息开关实际控制消息页签角标；清缓存保留会话及业务数据。现有本地化错误回退改为非递归，缺失资源时不无限递归。
- 新增可重复使用的 `scripts/export-playground.mjs`：从用户确认可运行的 iPad 原生工程导出直接可打开的 `.swiftpm`，真实登录为默认路径，演示数据只由“预览界面”触发；客户端继续消费现有 ParentAPI、Keychain 和家庭权限合同。开发地址从环境变量读取，导出目录要求全新。

## 模板与合同

- 没有改变 API、Supabase、数据表、现有数据、主开发服务或端口，也没有运行登录/业务写入、迁移和生产操作。
- 延续 V5 的原生 `MyApp.swift`、产品名、平台版本、图标、设备方向及 Workspace/Thumbnail 元数据；中英文继续内联为 Swift 字典。原始用户模板和 V5 保留。
- 任务卡中“保持原生 manifest”在真实 LAN 配置上需要一个明确增量：保留其余字段，只新增 `additionalInfoPlistContentFilePath`、plist 的 target exclude 和 `DEBUG` 编译标记。新 plist 配置服务 origin、本地网络用途和单主机 HTTP 例外；旧 CachedManifest 不复制，由 Playgrounds 重建。此处请集成人在任务卡准确记载，不能声称新版 manifest 与 V5 字节相同。
- 导出器保留模板的最低系统版本。本次用户模板为 iOS 26；常规 Xcode 工程仍为 iOS 17。没有借此修改常规 Release 的传输规则。

## 验证与证据

- `node apps/parent-ios/scripts/check.mjs`：13 个 Swift 文件引用、255 个双语键、项目资源及配置通过。
- `node apps/parent-ios/scripts/export-playground.test.mjs`：通过开发 origin 边界及实际导出检查，覆盖原模板保护、唯一入口、旧缓存排除、真实登录保留、单主机 HTTP 与 HTTPS 默认配置。`node --test` 在受限子进程模式遇到 EPERM，改用同一 node:test 文件直接运行并通过。
- 实际 V6 生成后用 Python plistlib 解析配置并检查单主机例外；确认唯一 `@main`、无 `Bundle.module`、启动 `store.restore()` 以及非空配置读取。十个修改文件与已提交 worktree 字节一致。
- 本次开发 HTTP 只读检查：health 200；未登录账号资源 401；zh 隐私和儿童隐私页均 200。已有密码登录、两个孩子、课程/报告/练习与无亲子关系 403 的后端结果复用集成任务记录，未重复造数或登录。
- `git diff --cached --check` 与暂存隐私扫描通过；提交 hook 保持启用。
- 新 V6 直接工程已经复制至用户原共享目录的新文件夹，22 个文件逐一 SHA-256 匹配；临时导出和摘要在本会话忽略的 `.tmp/parent-playground-20261001-01a0f814/native-template-v6/`。

## 未决与下一步

- Windows 无 Swift/Xcode。新版 SwiftUI 编译、Keychain 持久化、iPad LAN 登录与真实数据加载、系统分享、设置和二级页面视觉效果均待用户在实际 iPad 验证；V5 已能运行不能替代 V6 设备结果。
- 当前增量针对设置与相应二级入口，没有宣称全部 81 张截图已经逐项一致。测评预约、其他尚无接口的业务和系统推送保持实际能力边界。
- 已交付新的可操作工程给原用户。请集成人只读复核上述代码 head，集成后更新本任务登记和共享变更说明；后端合同和既有开发数据保持。
- 工作树：代码提交后干净；除本交接外无未提交修改。本任务没有后台服务或数据库占用。
- 状态：客户端机器检查通过，iPad V6 已交付待编译及人工验收；未部署生产，未关闭正式 Gate。
- 接收确认：待接收；请在已授权协调的原会话或集成人记录中确认。
