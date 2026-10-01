# DEV-PARENT-WECHAT-AUTH-UI-20261002 · codex 第 01 次交接

- 发出方 / 接收方：root 的独立 UI worktree / root 集成任务。
- 关联任务卡：[小程序微信登录与绑定入口](../tasks/DEV-PARENT-WECHAT-AUTH-UI-20261002.md)。
- 代码 base：`387b4c327e40ae352d03d861bc5253973f05f6ec`；代码 head：`b927e8ae0b742adaf2a8915924be5567ed3af033`。
- 分支 / worktree：`codex/parent-wechat-auth-ui-codex` / `.worktrees/parent-clients-integration-codex`。
- 当前状态：代码已复核并集成 main `bf8a5f9e`；本次交接同时补充开发样例的人工验收说明。

## 行为与合同

- 消费共用家长 API `0.5.0` 的微信能力查询、登录与绑定 DTO。客户端每次调用真实 `wx.login` 获取新 code，只有 `authenticated` 响应写入登录会话。
- 未绑定微信先提示登录已有账号，再明确确认绑定；已登录家长从账号弹层进入绑定。输入密码在请求前从页面清除，绑定保留原会话，账号切换时丢弃迟到结果。
- 配置关闭时显示准确提示并保留账号密码入口；六种微信失败原因提供中英文文案。账号弹层之外的双卡片、预约状态和四列服务布局继续沿用。
- 同步 README、业务配置说明与客户端合同测试。真实微信尚无 AppSecret 配置，客户端能力状态如实关闭。

## 检查与复核

- 新增微信客户端 14 项及受影响既有接口 / 小程序检查共 46 项通过，覆盖未知身份、明确绑定、会话保留、过期响应、code 失败及未配置入口。对应源码与 main 集成内容一致，复用结果。
- 使用仓库 TypeScript 执行 `tsc -p apps/parent-wechat/tsconfig.json` 及仅包含新增测试的类型配置，均通过；新增测试 ESLint 通过。根 ESLint 配置忽略原生小程序源文件，此处不将其列为 lint 已覆盖范围。
- Next.js 子 agent 对代码 head 完成只读复核，DTO、错误原因、首次绑定、原会话保留及并发保护无阻断发现。
- 集成服务真实 HTTP：匿名与固定家长微信状态 GET 均成功且 available=false；无效 Bearer 返回 401；登录 POST 返回 503 / WECHAT_NOT_CONFIGURED。
- 微信开发者工具刷新后，家长页加载两名孩子、微信状态关闭且无页面错误。刷新会异步回到默认页，待其完成再进入家长页后读取成功。模拟器已打开测评页，eligible=true 且无页面错误。
- 定向源码检查与运行状态不代表人工视觉或真实微信平台验收；原始运行材料保留在忽略的本机临时目录，交接只记录脱敏结果。

## 接续

- 本 worktree 无运行服务；提交后工作树干净。集成开发服务复用主 checkout，未创建第二个共享端口。
- 人工按 [开发样例说明](../../apps/parent-wechat/docs/portal.md#本机开发样例) 分别验收新申请、已有预约确认、活动、登记与课表。
- 真实微信登录需按共用合同 README 完成私有 AppSecret、同开放平台 UnionID、原生 Auth provider 和目标环境往返验证；相应开关在完成条件后启用。
- 接收确认：Next.js 已复核源代码，root 已集成并核对真实开发 HTTP 和模拟器状态。开发端已交付，待人工验收；生产部署与正式 Gate 本轮未执行。
