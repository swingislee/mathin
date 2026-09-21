# 微信原生家长端

使用原生 TypeScript、WXML、WXSS；不依赖 React 或网页运行时。

1. 在仓库根目录运行 `corepack pnpm install --frozen-lockfile`。
2. 微信开发者工具选择“导入项目”，目录指向当前文件夹（包含 project.config.json）。
3. 当前 AppID 为产品负责人选择的“格致未来思维”；登录具有该小程序开发权限的微信账号。
4. 使用工具内置 TypeScript 编译，打开四个底部入口查看外壳。无需启动 Next.js 或 Supabase。

文案跟随微信语言：英文使用 en，其他语言回退中文；每次进入页面同步原生标题与 tabBar。主题跟随系统外观。

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

官方 CLI 会校验 AppID，`touristappid` 可能返回 `APPID_ERROR`；此时先选择有开发权限的真实 AppID 或接口测试号，再配置项目。`compile` 的成功仅表示刷新请求已接收，运行结果结合 `logs`、`info` 和模拟器判断。业务页面的视觉与操作体验由产品负责人验收。

本机已完成官方 Skill 0.3.9、Codex 连接授权和“格致未来思维”AppID 配置；模拟器、编译触发、控制台、网络记录与当前课程页面读取已验证。个人配置开启热重载并保留域名校验。首次启动后若 `info` 返回自动化响应超时，先读取日志判断页面是否启动，再用 `open-full` 打开调试窗口后复查一次。

快捷入口在工具失败时返回退出码 `1`，在等待授权、登录或版本尚未就绪时返回 `2`，便于 Codex 正确保留未完成步骤。

当前不读取 API 配置。后续联调可将 `miniprogram/config.example.ts` 复制为 `config.local.ts` 并填写开发 origin；该文件已忽略。正式网络接入时配置合法 HTTPS 请求/上传域名；局域网 HTTP 仅在开发者工具的本地调试设置中使用。项目默认保留域名校验。

开发者工具生成的 JS、source map 和 project.private.config.json 不提交。
