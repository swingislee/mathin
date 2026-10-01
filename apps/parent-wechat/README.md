# 格致未来思维 · 微信原生小程序

使用原生 TypeScript、WXML、WXSS；不依赖 React 或网页运行时。

1. 在仓库根目录运行 `corepack pnpm install --frozen-lockfile`。
2. 微信开发者工具选择“导入项目”，目录指向当前文件夹（包含 project.config.json）。
3. 共享配置使用 `touristappid`。在已忽略的 `project.private.config.json` 顶层填写自己的 `appid`，并登录具有该小程序开发权限的微信账号；保留已有的 `setting` 等本机偏好。
4. 启动本机 Next.js 和隔离 Supabase；将 `miniprogram/config.example.ts` 复制为已忽略的 `config.local.ts`，填写开发 API origin。
5. 使用工具内置 TypeScript 编译，打开“发现、预约、安排、我的”。后台字段设置、接口依赖和验收操作见[业务配置说明](docs/portal.md)。

文案跟随微信语言：英文使用 en，其他语言回退中文；页面首次进入或语言变化时同步标题与 tabBar。后台发布内容保留原文，主题跟随系统外观。

## 对外文案

小程序对外品牌统一为“格致未来思维”，中英文界面保留这一专有名称。首屏围绕填写信息、问卷和活动预约组织，底部入口为“发现、预约、安排、我的”。界面使用“参与人”“参与档案”等符合实际用途的表达；课程安排、测评结果、老师反馈与练习详情仍准确展示业务内容。中英文同步维护，不因提审而隐藏实际服务或变更权限。

首层路由与视图采用 `discover`、`reservations`、`agenda`、`account`。旧 `courses` 链接跳转发现页；`mistakes`、`homework`、`practice` 保留为“我的”中的服务入口。公共文案集中维护在 `miniprogram/lib/locale.ts` 和 `copy.ts`，默认中文导航同步维护在 `app.json`。登记字段及活动展示内容继续由现有 Supabase 数据提供。

“安排”复用 iOS 同批的 `/api/v1/parent/learning` 与版本化 DTO，按参与人 ID 读取月度课表；不新增小程序专用课程、家庭或预约表。`api-types.ts` 由共用合同生成，调整接口时同时核对 Next.js、iOS 和小程序调用方。当前手机端视觉与交互需产品负责人验收。

```sh
corepack pnpm parents:wechat:typecheck
```

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
