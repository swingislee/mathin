# 学校运营开发库 schema 接入记录

日期：2026-09-05。范围：本机隔离开发环境；开发端已交付，待人工业务与视觉验收。

## 问题与修复

课程意向、续报、教师专业建议和长期运营页面已引用新模型，共享开发库仍缺身份转换、Phase 3 与 Phase 5 迁移。因此 PostgREST 无法解析报名选项 RPC、续报资格表、教师建议表以及学生到家庭的外键关联。

复核本机主机、应用实际 Supabase origin、监听进程和 Docker Compose 项目后，保存完整 PostgreSQL custom 备份并检查目录清单。在同一事务内应用以下现有迁移、登记规范化内容摘要并刷新 PostgREST schema cache。事务包含数据库指纹、原迁移头、现有业务计数、外键与新增表 RLS 断言。

| 迁移 | 规范化 SHA-256 |
| --- | --- |
| `20260905000100_school_ops_identity_conversion` | `ff2422441e0a900794699ee0e77b539c7f8cf5801b81b33360eabcd291116987` |
| `20260905000200_school_ops_phase3_enrollment_handoff` | `1a7ac12e6826e8915cbf1e8ae19ee225da620037cdf51277f053bfc76e65a96c` |
| `20260905000400_school_ops_phase5_renewal_lifecycle` | `cd65e2d7fb6099f51ac0a8d3129f8c4d29487c0ad177ba247057626e15720f54` |

开发库账本由 278 条推进至 281 条，head 为 `20260905000400_school_ops_phase5_renewal_lifecycle`。既有 `00300` 保持原样。

登录态检查同时发现学生列表通过状态常量导入了包含 `next/headers` 的数据模块。状态常量及列表 DTO 已提取到 `student-list-contract.ts`，`StudentsTable.tsx` 改用该客户端安全入口；`students.ts` 保留兼容导出。数据库类型已按本地接入后的 schema 重新生成。

## 本次验证

- 固定开发主管账号：3 个报名读取 RPC、续报资格表、教师专业建议表及完整的学生／家庭／联系人嵌套读取均返回 HTTP 200。
- 同一账号直接请求 zh/en 的课程意向、报名分班、续报池、教师建议、长期运营和学生列表，共 12 个页面均返回 HTTP 200，响应中无 schema cache、编译或服务端渲染错误。检查通过 HTTP 完成。
- 匿名请求报名选项 RPC、续报资格和教师建议均返回 HTTP 401 / `42501`。
- `pnpm typecheck`、受影响文件 ESLint、数据库类型摘要校验、`git diff --check` 通过。
- schema 事务前后的现有业务数量相同：账号 64、学生 1456、线索 1072、班级 141、班级成员关系 163、课次 111、考勤 0。

备份和无凭据接口检查摘要保存在 gitignored 的 `.tmp/school-ops-schema-repair-20260905/`。本次检查复用固定身份，业务验证采用读取；未补充报名或续报样例。

## 状态边界

本记录证明开发库缺失对象已接入、相关读取与页面可启动。报名保存、分班、续报批次和视觉交互仍由产品负责人实际操作验收。现有并行前端施工继续保留在共享工作树，Phase 3–6 与 R1-Live Gate 状态保持原有口径。本次没有生产迁移或发布。
