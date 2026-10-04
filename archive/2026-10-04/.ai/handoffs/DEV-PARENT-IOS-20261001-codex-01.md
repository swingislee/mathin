# DEV-PARENT-IOS-20261001 · 原生家长端第 1 次交接

- 发出方 / 接收方：iOS 主实现 Codex / 本批 main 集成人。
- 代码 base / head：`359d120c423c16afe4121358fce58957b31f9705` / `6483208bbd35d3d314ee1d33b871a55f8bf0f493`。
- 工作区：`.worktrees/parent-ios-reference-codex`，分支 `codex/parent-ios-reference-codex`。
- 用户授权：参考 81 张连续操作截图优先构建 iOS；复用现有 Supabase 表；明确授权 Supabase 与 Next.js 子 agent 同步升级并互审接口。

## 已交付

- SwiftUI 四页签：消息与联系人、课程与周／月课表、作业任务、家长与服务；复用参考中的低饱和紫色、白色圆角卡片、筛选层级及孩子切换，未复制参考个人信息和素材。
- 对接现有账号、会话刷新、孩子、通知已读、课程课次、反馈与测评、作业图片上传及提交、请假与处理记录。共用合同为 Next.js head `54c3aa5ad93183a46fb3ee2f1ae1c8daaa97909c`，Supabase 兼容补充为 `369a9729bde1f6f4cf9cb8e4dc9b5cb20088b5be`。
- 客户端按稳定孩子 ID 隔离，切换孩子重置详情导航与草稿；月历查询独立存储，保留主页窗口。作业提交重试保留提交 ID；非幂等请假响应不确定时先查看记录再人工决定重提。
- 明确选择的离线预览使用虚构数据，不访问后台，写入按钮禁用。聊天、通话、错题、调课、支付等缺少现有接口的能力提供状态说明，不生成业务成功。
- 按 origin 隔离的设备 Keychain、拒绝请求重定向、双语文案、暗色适配、PhotosPicker 按张选择和图片压缩。Release 强制 HTTPS、无 ATS 例外；Debug 通过本机配置使用单主机 HTTP 例外。
- 新增 Swift 核心合同测试、跨平台 Xcode 引用／本地化静态检查；现有 macOS CI 接入 Swift 测试与模拟器构建。

## 已执行检查

- 原生静态脚本通过：12 个 Swift 源引用、214 个中英文文案键、Xcode 资源及分环境配置。
- Python plistlib 解析 Debug / Release Info.plist 并核对公共元数据一致，通过。
- `node scripts/check-parent-foundation.mjs`、`git diff --cached --check`、27 文件暂存隐私扫描通过。最初的虚构含凭据 URL 测试字面值触发 hook，改用显式 URLComponents 测试数据后通过，hook 保持启用。
- Next.js 子 agent 对最终原生 head `6483208b` 只读复核，无明显阻断：HTTP 字段及 nullable、稳定 ID、提交重试、请假不确定状态、月历隔离、会话并发保护和 Debug / Release 配置一致。
- 后台定向合同测试及 Supabase 源码检查复用两 lane 已通过结果；详情见各自交接单。全仓类型检查存在原有 `tests/agent-coordination.test.ts` 的 4 处 `taskId` 错误，本增量未改这些文件。

## 未执行与下一步

- 当前主机为 Windows，没有 Swift / Xcode。新增 Swift 测试、Xcode 模拟器构建、原生交互和真机视觉验收均待 Mac 执行；CI 仅完成配置，没有远端通过证据。
- 没有执行数据库迁移、造数、Storage 写入或生产操作；只增加原有测评 RPC 的孩子 ID，未新增业务表。目标尚未迁移时沿用旧报告可空身份兼容提示。
- 在 Mac 按 [README](../../apps/parent-ios/README.md) 打开工程，可先选“预览界面”；真实账号路径需要已运行的共享 Next.js API 和已有亲子关系的开发账号。
- 人工验收：四主页面、两位孩子切换、中文／英文、大字号与深色、月历翻月、网络错误、作业提交与服务端记录、请假状态。错题等状态页确认说明准确，不作为已完成业务能力。
- 状态：源码与定向静态检查完成，待 main 接收及 Mac 构建／人工验收；生产部署和正式 Gate 均未改变。
