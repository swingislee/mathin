# 格致未来思维 · 微信原生小程序

使用原生 TypeScript、WXML、WXSS。2026-10-08 本轮调整已实现，交付开发端供实际体验；生产 API 与小程序平台发布另行办理。

底部入口为“发现、日历、我的”。发现页顶部是“参与者阶段、活动主题”，下方为“一对一诊断”和公益活动；日历页显示本周日历安排，可进入全部安排；我的页面提供关联参与人、参与登记、预约、活动记录及联系服务。原有卡片尺寸、四列服务网格、颜色和间距沿用当前版本。

## 开发与对外文案

1. 在仓库根目录运行 `corepack pnpm install --frozen-lockfile`，并用微信开发者工具导入当前目录。
2. 共享 AppID 保持占位；真实 AppID 与本机偏好保存于已忽略的 `project.private.config.json`。
3. 开发 API 为 `http://192.168.5.213:3130`，写入已忽略的 `miniprogram/config.local.ts`。已有 3130 服务优先复用。
4. 打开 `pages/discover/index` 查看本轮结果。小程序类型检查入口仍为 `corepack pnpm parents:wechat:typecheck`。

品牌固定为“格致未来思维”。文案跟随微信语言：英文使用 en，其余回退中文。公共文案维护在 `lib/locale.ts` 与 `lib/copy.ts`，默认导航同步维护在 `app.json`。诊断用途、真实年级选项、数学／英语、发布资料正文和信息使用说明保留真实含义。

首层路由为 `discover`、`calendar`、`account`；二级路由使用 `agenda`、`records`、`task`、`reflections`、`activity-*` 和 `service`。工程目录与工具命令保留旧路径，以兼容本机配置。

## 服务端与数据

小程序请求 `/api/v1/participant`；DTO 来自 [参与人合同](../../contracts/participant-api/README.md)，由 `node scripts/sync-participant-contract.mjs` 生成。服务端将 `calendar`、`stageNumber`、`facilitatorId`、`topics`、`taskId` 等字段转换到既有处理函数，账号、稳定 ID、范围校验与 RLS 继续复用。本轮无 Supabase 表名或字段改动，无数据库迁移，Messaging 与其他客户端沿用原接口。

未确认申请的旧缓存由单独兼容模块读取，新请求保留原申请 ID。活动发布资料尚无独立主题，未分类项目保留在“全部主题”，不会推测成数学；诊断的数学／英语时段来自已有真实配置。具体能力和后台资料位置见[业务配置说明](docs/portal.md)。

## Codex 与微信开发者工具协同

使用微信开发者工具随附的完整 `wechatide-skill`，将其安装到 Codex 的个人技能目录（例如 Windows 的 `%USERPROFILE%/.codex/skills/wechatide-skill`）。新技能可在下一轮对话使用；未出现时重新打开 Codex。工具升级后按官方 Skill 的版本检查结果同步整个目录。

在仓库根目录运行：

| 命令 | 用途 |
| --- | --- |
| `corepack pnpm parents:wechat status` | 检查登录、Skill 版本与连接授权 |
| `corepack pnpm parents:wechat open` | 打开当前工程的模拟器 |
| `corepack pnpm parents:wechat open-full` | 打开带编辑器和调试器的完整窗口 |
| `corepack pnpm parents:wechat compile` | 触发当前页面重新编译 |
| `corepack pnpm parents:wechat logs` | 读取模拟器控制台日志 |
| `corepack pnpm parents:wechat network` | 读取模拟器网络记录 |
| `corepack pnpm parents:wechat info` | 读取当前页面和运行时信息 |

首次连接需要在微信开发者工具中允许客户端 `Codex`；登录过期时按官方 Skill 扫码。Codex 调用 CLI 时使用可访问本机桌面的非沙箱执行环境。开启 CLI 访问令牌校验后，可通过当前进程的 `MATHIN_WECHATIDE_TOKEN` 提供令牌，凭据保留在用户私有配置中。

脚本自动定位 Windows/macOS 的常见安装目录，也支持环境变量 `WECHATIDE_CLI` 指定官方命令完整路径。Windows 调用保留中文和空格参数；官方 Skill 0.3.9 的安装自检若将 `C:\Program Files...` 截成 `C:\Program`，应使用带引号的完整路径读取 CLI 帮助并核对版本，记录为路径引用问题。实际连接可继续通过 `status` 核验。

官方 CLI 会校验 AppID，`touristappid` 可能返回 `APPID_ERROR`；此时选择有开发权限的真实 AppID 或接口测试号，写入 `project.private.config.json` 的 `appid`，共享配置保留占位值。`compile` 的成功仅表示刷新请求已接收，运行结果结合 `logs`、`info` 和模拟器判断。业务页面的视觉与操作体验由产品负责人验收。

本机已完成官方 Skill 0.3.9、Codex 连接授权和“格致未来思维”AppID 配置；模拟器、编译触发、控制台、网络记录与页面状态读取已验证。按产品负责人 2026-09-22 的明确授权，个人配置开启热重载并仅为局域网 HTTP 联调关闭域名校验。首次启动后若 `info` 返回自动化响应超时，先读取日志判断页面是否启动，再用 `open-full` 打开调试窗口后复查一次。

快捷入口在工具失败时返回退出码 `1`，在等待授权、登录或版本尚未就绪时返回 `2`，便于 Codex 正确保留未完成步骤。

API origin 从 `miniprogram/config.local.ts` 读取；运行类型检查时只会为缺失配置复制空值示例。正式网络接入配置合法 HTTPS 请求、上传与下载域名；共享 `project.config.json` 保留域名校验，局域网 HTTP 例外只写在已忽略的 `project.private.config.json`。

开发者工具生成的 JS、source map 和 project.private.config.json 不提交。
