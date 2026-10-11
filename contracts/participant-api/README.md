# 小程序参与人接口

小程序使用 `/api/v1/participant` 和 [portal.ts](portal.ts)。`src/features/participant-portal` 在服务端将业务记录投影为本合同，并复用正式身份与参与人关系。旧客户端接口继续兼容；新增登记提交由独立 RPC 校验账号、表单版本与参与人权限。

| 入口 | 内容 |
| --- | --- |
| `GET/POST auth/wechat`、`POST auth` | 原有登录、刷新、退出与明确绑定流程 |
| `POST guardian-binding` | `preview` 只返回部分姓名与有效期；`login`／`phone` 核对身份；`confirm` 携带监护关系和明确同意，关联已有学生 |
| `GET portal?resource=account` | 账号和有权访问的参与人 |
| `GET calendar?participant=…&from=…&to=…` | 参与人日历，字段为 `calendar`、`groups`、`stageNumber`、`facilitatorName` |
| `GET/POST activities` | 公益活动与报名；记录使用 `?resource=applications`，申请只接受 `kind=activity` |
| `GET assessment-slots` | 查询参数为 `participant`、`topics`、`stageNumber`，返回 `facilitators` 与可约时段 |
| `GET/POST assessments` | 一对一诊断预约，使用 `participantTimeOptions`、`facilitatorId`、`topics`、`stageNumber` |
| `GET/POST registrations` | 当前账号已提交的登记、当前启用表单（`?resource=form`）、幂等提交；`?resource=receipt&id=…` 仅核对本人请求回执 |
| `GET services`、`GET services/qr` | 阶段对应的服务联系方式 |
| `GET portal` | `form`、`bookings`、`reports`、`tasks`、`submission` |
| `POST portal`、`GET/POST media` | 原登记、取消及提交业务；任务提交使用 `taskId`，上传使用 `x-task-id` |

服务端转换逐项保留 ID、时间、记录内容、状态和错误响应。受保护读取和写入仍由既有处理函数验证当前身份、关联范围及 RLS；公开活动接口不返回或接受班级报名。资料正文和动态登记字段保持发布时的真实内容与稳定标识。

登记历史按提交时的字段快照展示用户填写内容，不返回内部身份凭据、定位或工作人员记录。后续补充保存为 `family_update`，保留首次登记与原来源；选择已有参与人不会修改正式档案或监护范围。新增参与人按既有登记流程建立关联。匿名访问不读取私人登记表或记录。

监护关联使用工作人员签发的七天一次性随机码。完整姓名、学生 ID 和学校等资料不进入预览；短期身份凭据只保存在小程序当前内存。扫码、手机号授权与普通登录均不写监护关系，只有明确确认调用受限事务；事务只连接原学生 ID，不按手机号合并，不新建学生。已完成结果可由同一微信身份短期重试，其他身份、已撤销或过期邀请被拒绝。关联记录独立保存为 `guardian`，参与信息登记仍由家长主动填写。

活动发布资料尚无独立主题字段，`topic` 暂为 `null`，可在“全部主题”中查看。分类补充前不从活动类型、标题或介绍推断主题。诊断的数学、英语选项来自既有时段合同。阶段编码保持原有数值含义，未知与不限阶段分别表示 `null` 和空数组。

小程序重命名页面和内部变量，旧缓存仅在 `lib/cache-compat.ts` 读取时转换字段；未确认申请保留原请求号。旧接口继续支持已发布客户端。微信工程目录与历史工具命令保留原路径，避免破坏本机工程配置。

运行 `node scripts/sync-participant-contract.mjs` 生成客户端 DTO，`--check` 核对同步。本轮仅开发端交付，生产 API 与小程序发布另行办理。
