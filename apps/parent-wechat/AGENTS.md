# 微信开发者工具协同

- 对外品牌与文案按 [README 的对外文案约定](README.md#对外文案)维护。
- 本工程使用官方 `wechatide-skill`。涉及开发者工具时先加载该 Skill，再按对应场景操作；本机首次接入已安装到 Codex 个人技能目录。
- 快捷入口为仓库根目录的 `corepack pnpm parents:wechat help`。入口从脚本位置计算工程绝对路径，支持 Windows 的中文和空格安装路径；自定义安装位置使用 `WECHATIDE_CLI`。
- 会话首次调用先执行 `parents:wechat status`，核对登录、Skill 版本和令牌要求；沿用官方 Skill 的授权任务处理方式。CLI 在可访问本机桌面的非沙箱环境运行。
- 本地常用顺序：`open` → 修改代码及相关静态检查 → `compile` → `logs` / `info`。`open-full` 显示完整调试窗口，`network` 读取网络记录。
- `compile` 成功只代表已触发刷新，须结合运行时结果判断；视觉和业务体验由产品负责人在模拟器与手机验收。
- AppID 使用用户选择且有开发权限的值。访问令牌放在用户私有配置或会话环境 `MATHIN_WECHATIDE_TOKEN`；共享代码与日志不记录令牌。
- 本机偏好放入已忽略的 `project.private.config.json`，保留域名校验。预览上传、生产 API 与云资源写入按本次明确授权范围执行。
