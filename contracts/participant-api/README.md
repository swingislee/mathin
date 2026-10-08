# 小程序参与人接口

小程序使用 `/api/v1/participant` 和 [portal.ts](portal.ts)。`src/features/participant-portal` 在服务端将既有业务记录投影为本合同，并把新字段映射回原处理函数。Supabase 原表、视图、RPC、身份关系、RLS、Messaging 和其他客户端接口保持原状，本次无数据库迁移。

| 入口 | 内容 |
| --- | --- |
| `GET/POST auth/wechat`、`POST auth` | 原有登录、刷新、退出与明确绑定流程 |
| `GET portal?resource=account` | 账号和有权访问的参与人 |
| `GET calendar?participant=…&from=…&to=…` | 参与人日历，字段为 `calendar`、`groups`、`stageNumber`、`facilitatorName` |
| `GET/POST activities` | 公益活动与报名；记录使用 `?resource=applications`，申请只接受 `kind=activity` |
| `GET assessment-slots` | 查询参数为 `participant`、`topics`、`stageNumber`，返回 `facilitators` 与可约时段 |
| `GET/POST assessments` | 一对一诊断预约，使用 `participantTimeOptions`、`facilitatorId`、`topics`、`stageNumber` |
| `GET services`、`GET services/qr` | 阶段对应的服务联系方式 |
| `GET portal` | `form`、`bookings`、`reports`、`tasks`、`submission` |
| `POST portal`、`GET/POST media` | 原登记、取消及提交业务；任务提交使用 `taskId`，上传使用 `x-task-id` |

服务端转换逐项保留 ID、时间、记录内容、状态和错误响应。受保护读取和写入仍由既有处理函数验证当前身份、关联范围及 RLS；公开活动接口不返回或接受班级报名。资料正文和动态登记字段保持发布时的真实内容与稳定标识。

活动发布资料尚无独立主题字段，`topic` 暂为 `null`，可在“全部主题”中查看。分类补充前不从活动类型、标题或介绍推断主题。诊断的数学、英语选项来自既有时段合同。阶段编码保持原有数值含义，未知与不限阶段分别表示 `null` 和空数组。

小程序重命名页面和内部变量，旧缓存仅在 `lib/cache-compat.ts` 读取时转换字段；未确认申请保留原请求号。旧接口继续支持已发布客户端。微信工程目录与历史工具命令保留原路径，避免破坏本机工程配置。

运行 `node scripts/sync-participant-contract.mjs` 生成客户端 DTO，`--check` 核对同步。本轮仅开发端交付，生产 API 与小程序发布另行办理。
