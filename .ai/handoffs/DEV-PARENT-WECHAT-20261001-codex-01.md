# DEV-PARENT-WECHAT-20261001 · 小程序发现与预约交接

- 发出方 / 接收方：小程序会话 Codex / iOS 同批集成人。
- 关联任务卡：[DEV-PARENT-WECHAT-20261001](../tasks/DEV-PARENT-WECHAT-20261001.md)。
- 登记基线：`5c3caf50cf33ce664abfd4aee7b000bdb473822e`。
- 代码 base / head：`38e84fb38c1b2a8a94bdbac50068793bdb35fdfc` / `6a8e5856029bffe7f54d6d1efb311c107c61168f`。
- 分支 / worktree：`codex/parent-wechat-discovery-codex` / `.worktrees/parent-wechat-discovery-codex`。
- 依赖：共用学习 API `54c3aa5ad93183a46fb3ee2f1ae1c8daaa97909c` 已合入 worker 编译基线。集成人已集成同一合同，接收时只需 cherry-pick 本单代码 head 与本交接提交。

## 用户可执行的动作

1. 在“发现”搜索近期活动，按地点、日期和名额筛选，打开真实活动详情；通过“信息与问卷”免登录提交已有动态表单。
2. 从活动页登录已有账号，返回原活动，选择参与人、核对信息并确认预约。网络结果不明确时先查看已有预约。已预约成员仍可切换到其他成员。
3. 在“预约”按成员查看待参与和历史记录，取消尚未开始的预约。刷新后通过成员 ID 保持选择，不依赖返回顺序。
4. 在“安排”按成员、月份和日期查看真实课程与活动。“本月课程”来自课表窗口聚合，次数不代表已购或剩余课时。
5. 在“我的”查看关联参与档案，进入预约、安排、结果回顾、练习记录及信息使用说明。未登录时保留公开活动和表单入口。

对外品牌沿用“格致未来思维”。主路由为 discover/reservations/agenda/account，首屏以信息、问卷和预约说明用途；真实课程、老师、反馈和练习详情继续准确展示。旧 courses 链接跳转发现，旧 mistakes/homework/practice 作为个人服务继续可用。

## 合同与环境

- 沿用现有 Supabase 表、账号与权限。小程序仅新增 shared learning GET 的消费 helper；共用 DTO 由 Next.js lane 维护，本次没有另建后端表或复制课程/家庭服务。
- 发现筛选范围为现有接口返回的近期活动，最多 100 场；达到上限有范围提示。匿名登记不自动建立账号、参与档案或预约，界面说明工作人员关联的下一步。
- 档案编辑、调课、支付、聊天和问卷历史接口尚无实现，当前不展示可执行入口。
- 无数据库写入、迁移执行、生产访问、服务重启或测试身份创建。临时分析与参考图片未提交。

## 验证与复核

- 小程序 TypeScript：`node node_modules/typescript/bin/tsc --noEmit -p apps/parent-wechat/tsconfig.json` 通过。
- 定向 Vitest：`tests/parent-wechat-discovery.test.ts`、`tests/parent-foundation.test.ts`、`tests/parent-portal-client.test.ts`，3 文件 / 18 项通过。覆盖筛选与名额、取消时限、月历跨年/闰年、登录返回、重试、重复点击、提交途中返回、多成员与多月份乱序响应。
- 新测试的定向 TypeScript 检查及两个修改测试文件的 ESLint 通过。
- `node scripts/check-parent-foundation.mjs` 与 `git diff --check` 通过；source commit 的 pre-commit 隐私扫描通过，暂存范围 31 文件。
- 只读子 agent `discovery_contract_audit` 已对代码 head 复核：成员选择器、提交途中返回、结果不确定的恢复入口、登录读取重试、参与人筛选稳定 ID 共五项问题均修复，该范围无阻断发现。复核未重复已有机器检查。
- 微信官方 Skill 0.3.9 与本机一致；用户已回应恢复登录，但 CLI 仍报告登录过期，官方 login 任务在工具重连后返回 Task not found。尚无模拟器编译、真机运行或人工视觉通过证据。

## 接收与验收

- 工作树提交后干净；没有任务自启的开发服务器。worker 复用主目录依赖的本机 junction，仅用于静态检查；未修改共享依赖或私有配置。
- 接收方：串行集成上述代码提交和本交接，更新本任务登记及 CHANGELOG。相同代码的机器结果可复用；集成冲突产生新增行为时针对新增风险检查。
- 用户验收：从主工程打开小程序，按本单动作检查中文/英文、发现筛选、登记、登录返回、两位成员、预约取消及月历切换。现有 Next.js 开发入口仍为仓库约定的局域网服务。
- 当前状态：源码与机器检查完成、开发端集成待接收、模拟器与用户视觉/业务验收待完成；没有生产部署或 Gate 关闭。
- 接收确认：待接收；由集成人在任务登记和已授权协调会话回传。
