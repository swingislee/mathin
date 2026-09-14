# Dashboard 逐路由核查 · 2026-09-15

状态：**第三条独立补丁已部署生产并通过发布后机器检查；Dashboard 路由清单完成核查，保留一项功能失败和动态样本边界，待用户生产体验验收**。本次授权为“单独发布。并再次对 dashboard 可能的路由做逐一核查”。

## 核查范围和方法

从实际 `src/app/[locale]/dashboard` 枚举 **82 个页面、2 个读取接口**，包含 22 个动态路由、11 个显式旧地址兼容入口。另检查 29 个主要查询状态：学生五阶段工作／全部记录、再联系四组及同组范围、回收站、学生详情标签、沟通记录和活动后队列、课件工作区、首页工作／总览与教学视图。

开发固定管理员执行 368 次完整 HTTP 请求；中文分别记录首次请求和预热请求，英文记录一次。解析流式 RSC 的错误与跳转，避免把 HTTP 200 外壳误当作业务成功。表中耗时是开发服务器完整响应，不包含浏览器下载静态资源、客户端渲染和用户网络；也不是生产页面体验。家长／学生专用入口按管理员应有的跳转记录，未切换正式生产账号。

生产对全部 84 个路由执行 zh/en **168 项匿名鉴权检查，全部按预期跳转登录**，P95 约 142 ms；这部分只证明匿名保护。对已知慢数据入口另用既有生产管理员数据库权限上下文执行 `REPEATABLE READ READ ONLY`，仅输出数量、大小和时间，完整业务行留在数据库。生产真实浏览器会话和交互仍待用户验收。

## 结果与待处理项

- 第三条独立候选 `1ad14a81` 仅应用 `20260914003000_student_recontact_read_path`；生产账本 385，应用 `3d9892bb` / PID 3825682 保持。备份、回滚零残留、正式提交、独立数据库及 43 项运行检查通过，业务摘要保持、错误增量为 0。见[完整发布记录](student-recontact-read-performance-20260914.md)。
- **功能失败：再联系 → 同组。** 页面允许 `scope=group`，旧 RPC 校验仍只接受 `mine/all/unassigned`，双语请求均得到 `VALIDATION`。既有协作迁移按另一种枚举顺序替换字符串，未命中该函数。生产演练和开发页面分别复现；本条性能补丁保留原行为，这一功能问题尚未修复。
- **剩余慢读取：** 生产再联系沉默完整 RPC 约 4.80 秒、我的未接通约 3.68 秒；开发全部记录首联约 2.59 秒、测评约 2.92 秒，课件队列约 2.22 秒。开发档案历史约 2.52 秒包含生产关闭的原始资料读取，不能据此判断生产慢。
- 课程列表中文初轮两次 500，英文正常；两次定向复测为 200、554 / 489 ms，未持续复现。初轮未留存错误正文，根因尚未确认，不能记为已修复。
- 开发动态核查期间连接中断，3130 监听进程后来由 26428 变为 38976。恢复后只补跑中断的 9 个动态路由。手动启动标准开发命令遇到端口已占用后停止，复用已恢复服务；未操作生产应用进程。退出原因尚未确认。
- 初选历史测评记录被 `HISTORICAL_RECORD_READ_ONLY` 拒绝；从当前登记和当前活动中选取有效样本后，详情双语正常（中文约 267 ms）。续报原始表中有记录，但当前工作台没有可用详情样本，因此当前详情只覆盖 404 保护。
- 公开课活动及其打印／微课、作业详情、微课审核、已生成测评报告缺少现有可用样本；通知详情会标记已读，本次只检查不存在记录的回退路径。表格明确标注这些边界，不创建临时业务数据补齐。
- 生产与开发的学生内部协作 helper 另有版本差异，本批三条补丁保持它们原样，见[前两条及差异记录](school-route-performance-20260914.md)。

## 生产数据读取复测

| 入口 | 生产数据库耗时 |
| --- | ---: |
| 学生工作四阶段（首联／测评／报名／续报） | 369 / 396 / 314 / 405 ms |
| 学生全部记录四阶段 | 1,123 / 1,297 / 629 / 494 ms |
| 线索全部／我的 | 101 / 256 ms |
| 分班 | 92 ms |
| 测评顺序候选 | 64 ms |
| 续报健康事实（首批 200 人） | 100 ms |

## 页面与读取接口逐项结果

中文栏使用有效复测中的第二次请求；英文使用相应单次请求。跳转目标包含语言前缀；动态 ID 均脱敏。续报样本虽存在于原始表，当前工作台不可用，上文已单独说明。

| 路由（省略语言前缀） | 中文结果 | 中文预热后 ms | 英文结果 | 英文 ms | 样本边界 |
| --- | --- | ---: | --- | ---: | --- |
| `/dashboard/academic-years` | 200 | 731 | 200 | 275 |  |
| `/dashboard/access-control` | 200 | 306 | 200 | 298 |  |
| `/dashboard/account-security` | 200 | 284 | 200 | 284 |  |
| `/dashboard/account-support` | 200 | 240 | 200 | 260 |  |
| `/dashboard/activities/[activityId]` | 404 保护 | 345 | 404 保护 | 316 | 无现有样本 |
| `/dashboard/activities/[activityId]/print` | 404 保护 | 335 | 404 保护 | 323 | 无现有样本 |
| `/dashboard/activities/[activityId]/segments/[segmentId]/microcourse` | 404 保护 | 470 | 404 保护 | 391 | 无现有样本 |
| `/dashboard/activities` | 200 | 318 | 200 | 289 |  |
| `/dashboard/assessments/[registrationId]` | 跳转 /zh/dashboard/followups/assessments/:id | 348 | 跳转 /en/dashboard/followups/assessments/:id | 375 | 已有样本 |
| `/dashboard/assessments/learning-matrix-preview` | 跳转 /zh/dashboard/followups/assessments/learning-matrix-preview | 243 | 跳转 /en/dashboard/followups/assessments/learning-matrix-preview | 267 |  |
| `/dashboard/assessments` | 跳转 /zh/dashboard/followups/assessments | 238 | 跳转 /en/dashboard/followups/assessments | 242 |  |
| `/dashboard/assessments/support-preview` | 跳转 /zh/dashboard/followups/assessments/support-preview | 254 | 跳转 /en/dashboard/followups/assessments/support-preview | 260 |  |
| `/dashboard/assignments/[assignmentId]` | 跳转 /zh/dashboard | 403 | 跳转 /en/dashboard | 370 | 无现有样本 |
| `/dashboard/assignments` | 跳转 /zh/dashboard | 244 | 跳转 /en/dashboard | 267 |  |
| `/dashboard/campuses/[campusId]` | 200 | 370 | 200 | 361 | 已有样本 |
| `/dashboard/campuses` | 200 | 271 | 200 | 322 |  |
| `/dashboard/children` | 跳转 /zh/dashboard | 284 | 跳转 /en/dashboard | 251 |  |
| `/dashboard/classes/[classId]` | 200 | 453 | 200 | 399 | 已有样本 |
| `/dashboard/classes/import` | 200 | 270 | 200 | 268 |  |
| `/dashboard/classes/import/roster` | 200 | 511 | 200 | 544 |  |
| `/dashboard/classes/new` | 200 | 295 | 200 | 262 |  |
| `/dashboard/classes` | 200 | 322 | 200 | 346 |  |
| `/dashboard/coordination` | 200 | 245 | 200 | 256 |  |
| `/dashboard/courses/[courseFamilyId]/microcourse-settings` | 200 | 427 | 200 | 447 | 已有样本 |
| `/dashboard/courses/[courseFamilyId]/microcourses/[courseId]` | 200 | 399 | 200 | 436 | 已有样本 |
| `/dashboard/courses/[courseFamilyId]` | 200 | 451 | 200 | 475 | 已有样本 |
| `/dashboard/courses/new` | 200 | 342 | 200 | 328 |  |
| `/dashboard/courses` | 200 | 489 | 200 | 983 |  |
| `/dashboard/courseware-assets/[assetId]` | 200 | 362 | 200 | 334 | 已有样本 |
| `/dashboard/courseware-assets` | 200 | 1969 | 200 | 1695 |  |
| `/dashboard/courseware/lectures/[lectureId]` | 200 | 437 | 200 | 484 | 已有样本 |
| `/dashboard/courseware/microcourse-reviews/[reviewCycleId]` | 404 保护 | 326 | 404 保护 | 343 | 无现有样本 |
| `/dashboard/courseware` | 200 | 2222 | 200 | 1718 |  |
| `/dashboard/courseware/review` | 200 | 233 | 200 | 247 |  |
| `/dashboard/coursework` | 跳转 /zh/dashboard | 224 | 跳转 /en/dashboard | 256 |  |
| `/dashboard/data-maintenance` | 200 | 366 | 200 | 386 |  |
| `/dashboard/enrollments` | 跳转 /zh/dashboard/followups/enrollments | 218 | 跳转 /en/dashboard/followups/enrollments | 226 |  |
| `/dashboard/finance` | 跳转 /zh/dashboard | 265 | 跳转 /en/dashboard | 273 |  |
| `/dashboard/followups/assessments/[registrationId]` | 200 | 267 | 200 | 306 | 已有样本 |
| `/dashboard/followups/assessments/[registrationId]/reports/[reportId]` | 404 保护 | 324 | 404 保护 | 380 | 无现有样本 |
| `/dashboard/followups/assessments/learning-matrix-preview` | 200 | 323 | 200 | 328 |  |
| `/dashboard/followups/assessments` | 200 | 897 | 200 | 881 |  |
| `/dashboard/followups/assessments/support-preview` | 跳转 /zh/dashboard/followups/assessments | 246 | 跳转 /en/dashboard/followups/assessments | 240 |  |
| `/dashboard/followups/communication` | 200 | 881 | 200 | 1030 |  |
| `/dashboard/followups/enrollments` | 200 | 951 | 200 | 947 |  |
| `/dashboard/followups/leads` | 200 | 599 | 200 | 627 |  |
| `/dashboard/followups` | 200 | 238 | 200 | 254 |  |
| `/dashboard/followups/renewals/[opportunityId]` | 404 保护 | 508 | 404 保护 | 437 | 已有样本 |
| `/dashboard/followups/renewals/growth` | 200 | 556 | 200 | 578 |  |
| `/dashboard/followups/renewals` | 200 | 536 | 200 | 560 |  |
| `/dashboard/followups/renewals/signals` | 200 | 292 | 200 | 293 |  |
| `/dashboard/history-import` | 200 | 1133 | 200 | 1153 |  |
| `/dashboard/history-import/test` | 200 | 457 | 200 | 464 |  |
| `/dashboard/invitations` | 跳转 /zh/dashboard/followups/communication | 249 | 跳转 /en/dashboard/followups/communication | 241 |  |
| `/dashboard/leads` | 跳转 /zh/dashboard/followups/leads | 427 | 跳转 /en/dashboard/followups/leads | 341 |  |
| `/dashboard/learning/classes/[classId]` | 跳转 /zh/dashboard | 255 | 跳转 /en/dashboard | 292 | 已有样本 |
| `/dashboard/learning/classes` | 跳转 /zh/dashboard | 293 | 跳转 /en/dashboard | 288 |  |
| `/dashboard/management-analytics` | 200 | 396 | 200 | 364 |  |
| `/dashboard/notifications/[deliveryId]` | 跳转 /zh/dashboard | 251 | 跳转 /en/dashboard | 264 | 通知仅检查不存在记录，保留已读状态 |
| `/dashboard/opportunities` | 跳转 /zh/dashboard/followups/communication?queue=post_activity | 292 | 跳转 /en/dashboard/followups/communication?queue=post_activity | 300 |  |
| `/dashboard/organization` | 200 | 257 | 200 | 262 |  |
| `/dashboard/overview-detail` | 200 | 809 | 200 | 747 |  |
| `/dashboard` | 200 | 1448 | 200 | 1432 |  |
| `/dashboard/progress` | 跳转 /zh/dashboard | 423 | 跳转 /en/dashboard | 265 |  |
| `/dashboard/registration-settings` | 200 | 406 | 200 | 258 |  |
| `/dashboard/renewals/[opportunityId]` | 跳转 /zh/dashboard/followups/renewals/:id | 251 | 跳转 /en/dashboard/followups/renewals/:id | 246 | 已有样本 |
| `/dashboard/renewals/growth` | 跳转 /zh/dashboard/followups/renewals/growth | 238 | 跳转 /en/dashboard/followups/renewals/growth | 260 |  |
| `/dashboard/renewals` | 跳转 /zh/dashboard/followups/renewals | 285 | 跳转 /en/dashboard/followups/renewals | 274 |  |
| `/dashboard/renewals/signals` | 跳转 /zh/dashboard/followups/renewals/signals | 289 | 跳转 /en/dashboard/followups/renewals/signals | 259 |  |
| `/dashboard/schedule` | 200 | 267 | 200 | 283 |  |
| `/dashboard/sessions/[sessionId]/microcourse` | 200 | 256 | 200 | 253 | 已有样本 |
| `/dashboard/sessions/[sessionId]` | 200 | 366 | 200 | 348 | 已有样本 |
| `/dashboard/staff` | 200 | 319 | 200 | 316 |  |
| `/dashboard/students/[studentId]` | 200 | 286 | 200 | 331 | 已有样本 |
| `/dashboard/students/confirm` | 404 保护 | 258 | 404 保护 | 261 |  |
| `/dashboard/students/entry-detail` | 200 | 210 | 200 | 222 |  |
| `/dashboard/students/groups` | 200 | 319 | 200 | 467 |  |
| `/dashboard/students/import` | 200 | 298 | 200 | 307 |  |
| `/dashboard/students` | 200 | 248 | 200 | 286 |  |
| `/dashboard/students/review` | 跳转 /zh/dashboard/students?population=records | 273 | 跳转 /en/dashboard/students?population=records | 276 |  |
| `/dashboard/system-health/capabilities` | 200 | 321 | 200 | 298 |  |
| `/dashboard/system-health` | 200 | 554 | 200 | 622 |  |
| `/dashboard/targets` | 200 | 266 | 200 | 268 |  |
| `/dashboard/teaching` | 200 | 404 | 200 | 327 |  |

## 主要查询状态

| 路由（省略语言前缀） | 中文结果 | 中文预热后 ms | 英文结果 | 英文 ms | 样本边界 |
| --- | --- | ---: | --- | ---: | --- |
| `/dashboard?view=overview` | 200 | 1382 | 200 | 1376 |  |
| `/dashboard/students?population=work&stage=awaiting_first_contact&scope=all` | 200 | 1340 | 200 | 1331 |  |
| `/dashboard/students?population=work&stage=awaiting_assessment&scope=all` | 200 | 1574 | 200 | 1552 |  |
| `/dashboard/students?population=work&stage=awaiting_enrollment&scope=all` | 200 | 1051 | 200 | 1057 |  |
| `/dashboard/students?population=work&stage=awaiting_renewal&scope=all` | 200 | 1338 | 200 | 1407 |  |
| `/dashboard/students?population=work&stage=former_student&scope=all` | 200 | 884 | 200 | 880 |  |
| `/dashboard/students?population=records&stage=awaiting_first_contact&scope=all` | 200 | 2586 | 200 | 2732 |  |
| `/dashboard/students?population=records&stage=awaiting_assessment&scope=all` | 200 | 2917 | 200 | 2893 |  |
| `/dashboard/students?population=records&stage=awaiting_enrollment&scope=all` | 200 | 1786 | 200 | 1800 |  |
| `/dashboard/students?population=records&stage=awaiting_renewal&scope=all` | 200 | 1913 | 200 | 1846 |  |
| `/dashboard/students?population=records&stage=former_student&scope=all` | 200 | 1699 | 200 | 1751 |  |
| `/dashboard/students?population=recontact&reason=unreachable&scope=all` | 200 | 1177 | 200 | 1103 |  |
| `/dashboard/students?population=recontact&reason=assessed&scope=all` | 200 | 1977 | 200 | 1933 |  |
| `/dashboard/students?population=recontact&reason=former&scope=all` | 200 | 1255 | 200 | 1369 |  |
| `/dashboard/students?population=recontact&reason=dormant&scope=all` | 200 | 2223 | 200 | 2184 |  |
| `/dashboard/students?population=recontact&reason=unreachable&scope=group` | 错误：VALIDATION | 255 | 错误：VALIDATION | 247 |  |
| `/dashboard/students?tab=recycle` | 200 | 581 | 200 | 560 |  |
| `/dashboard/students/[studentId]?tab=followups` | 200 | 313 | 200 | 292 | 已有样本 |
| `/dashboard/students/[studentId]?tab=history` | 200 | 2515 | 200 | 2461 | 已有样本 |
| `/dashboard/students/[studentId]?tab=learning` | 200 | 309 | 200 | 329 | 已有样本 |
| `/dashboard/students/[studentId]?tab=videos` | 200 | 326 | 200 | 313 | 已有样本 |
| `/dashboard/students/[studentId]?tab=guardians` | 200 | 336 | 200 | 290 | 已有样本 |
| `/dashboard/students/[studentId]?tab=finance` | 200 | 316 | 200 | 307 | 已有样本 |
| `/dashboard/followups/communication?view=records` | 200 | 482 | 200 | 433 |  |
| `/dashboard/followups/communication?queue=post_activity` | 200 | 889 | 200 | 872 |  |
| `/dashboard/courseware/lectures/[lectureId]?workspace=courseware` | 200 | 609 | 200 | 547 | 已有样本 |
| `/dashboard?view=work` | 200 | 529 | 200 | 552 |  |
| `/dashboard/teaching?view=tasks` | 200 | 724 | 200 | 401 |  |
| `/dashboard/teaching?view=progress&period=month` | 200 | 335 | 200 | 520 |  |

## 证据保留

本机聚合结果保存在 gitignored `.tmp/dashboard-route-audit-20260915/`；选样 ID、原始 HTML、登录 Cookie 和凭据不进入共享证据。受控归档 `/home/swing/services/mathin/staging/student-recontact-1ad14a81f7da-20260914/dashboard-route-audit-20260915.tar.gz`，15,741 bytes，SHA-256 `67d22261c7299536ae53394de4dae6a05ddcf46c40af37c5d181adf9f76f0218`；远端文件和包内摘要校验通过，owner-only，生产运维维护者可访问，保留至 `v1.0.0 + 365 天`。页面人工体验与 R1-Live-2 / Gate 状态保持分别记录。
