# Mathin Agent 入口

本仓库以产品负责人当前任务为施工范围。产品构思读 [产品方向](docs/product-direction.md)，交付事实读 [当前状态](docs/current.md)。历史材料集中在 [archive](archive/README.md)，按明确问题查阅。

## 每轮工作

- 开始时检查工作树，尊重其他任务的修改和未跟踪文件；核对 `main` 的 [任务登记](.ai/registry.json) 中正在进行的文件归属。
- 先形成可操作版本，交给产品负责人在真实场景中使用，再按反馈继续修改。普通增量直接实现、交付，不默认运行测试、大面积审核、备份、回滚演练或冒烟。
- 测试仅在用户明确要求，或变更可能造成重大安全、生产事故时按具体风险选择。必要构建用于生成可交付程序。风险操作见 [操作规则](docs/agent/operations.md)。
- 已实现、开发端可用、生产已部署和用户已验收分别记录；已有可信事实可以复用。
- Windows 文本按无 BOM UTF-8 读写；PowerShell 使用 `Get-Content -LiteralPath … -Encoding UTF8`。乱码先核对原始字节与解码。
- 使用正面、具体、可执行的表达。规则讲清动作与目的，硬限制留给真实的数据、权限、密钥和兼容边界。
- 浏览器及共享代码使用 `@/lib/uuid` 的 `newId()`，支持局域网 HTTP；纯服务端可从 `node:crypto` 导入。
- 凭据从环境变量或忽略的私有配置读取，临时材料放 `.tmp/`；共享命令、源码、日志和提交不得包含真实密码、Token、Cookie 或个人数据。
- `xiaomi`、`192.168.5.183`、`mathin.club`、`supabase.mathin.club` 是生产。生产写入、迁移和服务切换需要本次任务的明确授权；操作前按 [数据操作](docs/ops/data-operations.md) 核对实际目标。本地数据库写入同样先识别真实主机、origin、监听进程和环境。
- 正式身份、学生、班级、课次、考勤、冻结版本与受保护课程资源不得作为测试垃圾清理。删除和不可逆操作先明确对象范围与恢复办法。

## 按任务查阅

| 当前工作 | 需要的资料 |
| --- | --- |
| 新功能或产品调整 | [产品方向](docs/product-direction.md) 与对应 [教学](docs/workflows/teaching.md)、[学校运营](docs/workflows/school-operations.md)、[内容](docs/workflows/content.md) 场景 |
| UI、路由、交互 | [设计](docs/design.md)、[前端入口](docs/agent/frontend.md)，以及最近目录的 `AGENTS.md` |
| 数据、鉴权、课堂同步 | [数据与课堂](docs/agent/data-and-classroom.md) |
| 并行、接手或交接 | [协作](docs/agent/collaboration.md) 与相关任务卡 |
| 状态整理或规划 | [规划](docs/agent/planning.md) |
| 部署、清理、验证 | [操作规则](docs/agent/operations.md)，再按具体动作读取 `docs/ops/` |

每次只展开当前工作需要的资料。项目技能以 Git 跟踪的 `.agents/skills/` 为共享源。规则在所属文档维护，根入口保持简短。

## 交付

开发验收链接统一使用 `http://192.168.5.213:3130/…`。视觉、教学手感和业务效果由产品负责人实际验收；需要浏览器或自动化验证时按明确任务调用验证技能。

每个可独立使用的增量单独提交，只包含本任务文件。交付说明写明改了什么、可操作入口、实际检查范围和待确认内容。长任务先完成当前安全增量并留下简短交接，再判断是否需要新会话继续。
