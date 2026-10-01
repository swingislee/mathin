# DEV-PARENT-WECHAT-20261001 · 小程序家长发现与预约入口

- 用户在「梳理小程序家长入口与协作」会话明确授权与 iOS 会话协作；集成人已只读核对该用户消息。
- 目标：参考小程序示例图，构建发现、预约、安排、我的；保留真实课程与参与详情，不用包装隐藏实际业务。
- 沿用现有品牌「格致未来思维」、匿名登记/问卷、活动预约、亲子关系与数据。后端扩展复用 iOS 同批 Supabase/Next.js 合同，禁止另建平行业务表。
- 前端独立 worktree；只读子 agent `discovery_contract_audit` 协助核查已有合同，无独立写路径。
- `api-types.ts` 由 DEV-PARENT-IOS-NEXT-20261001 独占生成。新增 learning API 见该 lane 已提交的 portal.ts 与 README；等待精确合同提交再消费。
- 当前暂定基线为此卡提交。实现者自行从 main 包含本卡的提交建登记分支，工作结束提交源代码与交接，由当前集成人处理 main 与 CHANGELOG。
- 独立身份以学生 UUID 筛选；报告 participantId 缺失不按姓名匹配。课表聚合不表示已购买课程目录或剩余课时。
- 环境与验证：不创建测试身份、不写数据库、不接生产；按变更执行窄测试及小程序类型检查；人工验收状态另记。
- API：GET /api/v1/parent/learning?participant=<UUID>，POST action=leave/readNotification；原 account/activities/bookings/reports/practices/intake/submit/media 保持兼容。
