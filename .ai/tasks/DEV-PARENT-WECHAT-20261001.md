# DEV-PARENT-WECHAT-20261001 · 小程序家长发现与预约入口

- 用户在「梳理小程序家长入口与协作」会话明确授权与 iOS 会话协作；集成人已只读核对该用户消息。
- 当前目标：尽可能按小程序示例图复刻布局和分页，仅适配项目主题色并删除无效说明；底栏调整为「发现／课程／家长」。保留真实课程与参与详情，展示准确业务用途。
- 沿用现有品牌「格致未来思维」、匿名登记/问卷、活动预约、亲子关系与数据。后端扩展复用 iOS 同批 Supabase/Next.js 合同，禁止另建平行业务表。
- 前端独立 worktree；只读子 agent `discovery_contract_audit` 协助核查已有合同，无独立写路径。
- `api-types.ts` 由 DEV-PARENT-IOS-NEXT-20261001 独占生成。新增 learning API 见该 lane 已提交的 portal.ts 与 README；等待精确合同提交再消费。
- 当前暂定基线为此卡提交。实现者自行从 main 包含本卡的提交建登记分支，工作结束提交源代码与交接，由当前集成人处理 main 与 CHANGELOG。
- 独立身份以学生 UUID 筛选；报告 participantId 缺失不按姓名匹配。课表聚合不表示已购买课程目录或剩余课时。
- 环境与验证：不创建测试身份、不写数据库、不接生产；按变更执行窄测试及小程序类型检查；人工验收状态另记。
- API：GET /api/v1/parent/learning?participant=<UUID>，POST action=leave/readNotification；原 account/activities/bookings/reports/practices/intake/submit/media 保持兼容。

## 2026-10-01 视觉与分页调整

- 集成人已直接核验原会话人类消息 `01a0f7ea-d691-7e30-9a0b-a2554faba4a9`：尽可能复刻示例前端、只保留主题色适配、去掉无效描述，并使底部分页逻辑与示例一致。
- 沿用原独立工作区与分支。前一批源码已集成的事实与 checkpoint 保留；本轮状态重新进入施工，记录新的代码提交与第 03 次交接。
- 课程首页展示本周课程，完整课表放二级页；预约入口进入发现与家长页。按示例调整卡片、筛选弹层、两步预约和家长服务网格。
- 新增 theme.json、components/、assets/ 归属供本轮样式与复用组件使用；其余沿用已登记前端范围。共享 CHANGELOG 由集成人串行处理。
- `scripts/check-parent-foundation.mjs` 本轮交给小程序实现者同步导航断言：页签数为 3，顺序为 discover/courses/account，并与 app.pages 前三项一致；脚本的其他工程与合同检查继续保留。
- 继续消费既有共享 API，本轮不改后端或数据库。运行受影响的窄检查并交付独立工作区供人工视觉验收；自动化结果不替代用户对复刻程度的确认。
