# Mathin Agent 入口

> 本文件只保留每轮都需要的约束。实现细则按任务路由读取，禁止默认展开整个 `docs/plan/` 或全部 Agent 文档。

## 每轮硬约束

- `docs/plan/04-roadmap.md` 顶部“当前施工阶段”是唯一阶段入口；历史编号、旧正文和未勾选项不能覆盖它。
- 开始前检查工作树。既有修改和未跟踪文件均视为用户或其他任务所有；不得覆盖、回滚、移动或顺手格式化。
- Windows 文本默认按无 BOM UTF-8 处理；PowerShell 读取必须显式 `-Encoding UTF8`。乱码先按解码问题调查，不得据此重写文件。
- `xiaomi`、`192.168.5.183`、`mathin.club` 和 `supabase.mathin.club` 都是生产。未取得本次明确授权并完成 [`r1-write-target-policy.md`](docs/runbooks/r1-write-target-policy.md) 的只读 preflight，禁止生产迁移、造数、业务写入、服务重载或重启。
- 本地数据库写入前也要核对执行主机、实际 Supabase origin、监听进程和目标环境；容器名不能证明环境。任一项不明确即停止。
- 正式身份、班级、课次、学生、考勤、冻结 release/snapshot 和受保护课程资源不得当作测试数据清理；删除、purge、不可逆迁移和生产高风险动作必须走对应授权与 runbook。
- 机器检查、开发端可验收、已部署待验收、用户已验收和正式 Gate 关闭是不同状态，汇报时不得互相替代。
- 用户沟通、规则、计划、代码注释和交付说明默认使用正面、可执行的描述，直接说明应采取的动作与预期结果；安全边界、不可逆操作或明确兼容禁区需要硬限制时再使用禁止性表述。
- 新规则只有每轮都适用时才进入本文件；其余放入对应按需文档。同一规则只保留一个权威位置，根文件保持在 6 KB 以内。

## 按任务读取

先读下表命中的最小集合；跨类型任务取并集。只有规划治理、跨域架构或发布收口才全文读取 active 规划。

| 任务 | 必读 |
| --- | --- |
| 任意实现 | `docs/plan/00-overview.md` 的状态头、§5 和与目标直接相关的产品章节；`docs/plan/04-roadmap.md` 的状态头与对应当前 work item；最近目录中的 `AGENTS.md`（若存在） |
| 规划、阶段或 Gate | [`docs/agent/planning.md`](docs/agent/planning.md)；按其中规则读取 00/04/25 和专题文档 |
| UI、路由、视觉、交互、Next.js | [`docs/agent/frontend.md`](docs/agent/frontend.md)；`docs/plan/01-design-system.md`，按需读取 `docs/plan/02-pages.md`、`docs/plan/05-planet-themes.md` 与相关专题 |
| 数据库、鉴权、RLS、Server Action、测试身份 | [`docs/agent/data-and-classroom.md`](docs/agent/data-and-classroom.md)；`docs/plan/03-data-and-tech.md` 的相关章节 |
| 游戏、H5、空间/3D、课堂 renderer | [`docs/agent/data-and-classroom.md`](docs/agent/data-and-classroom.md) 的课堂同步章节；最近目录的局部 `AGENTS.md` |
| 本地验证、Git、证据、部署或生产运维 | [`docs/agent/operations.md`](docs/agent/operations.md)；涉及生产写入时再读目标操作 runbook |

## 实现与交付

- 默认内循环：确认变更面 → 实现 → 覆盖本次风险的最窄检查 → 尽早交付可操作版本。不要为低风险小改动重复跑全量 Gate。
- UI/交互由产品负责人在开发页面人工验收。除非明确要求，不用浏览器控制、Playwright 或截图替代验收；交付链接统一使用 `http://192.168.5.213:3130/...`。
- 视觉未明确通过前，只做页面可启动、类型/版本化合同和本次硬门所需的窄检查，状态写为“开发端已交付，待人工视觉验收”。
- 每个已验证、可独立验收的增量单独提交 Git，只包含本任务文件；不得夹带当前工作树中的其他改动。
- 只有阶段确实关闭时才同步专题状态头、doc 04、doc 25、证据索引并运行 `pnpm plan:audit`；普通小改动不伪造阶段收口。
