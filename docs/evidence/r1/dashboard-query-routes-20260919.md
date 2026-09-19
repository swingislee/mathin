# Dashboard 查询入口覆盖清单（2026-09-19）

基于 `894927a0` 及本轮补丁的源码可达性扫描。数字包含共享布局、按需操作和写命令，表示需要核查的静态调用点，**不是页面发起的请求数或耗时**。判定、实测与验证边界见[核查记录](dashboard-query-audit-20260919.md)。

## Dashboard 入口

| 入口（省略 locale） | 可达调用点 | 表读取 | RPC |
| --- | ---: | ---: | ---: |
| `/dashboard/academic-years/page.tsx` | 142 | 54 | 85 |
| `/dashboard/access-control/page.tsx` | 126 | 49 | 76 |
| `/dashboard/account-security/page.tsx` | 135 | 53 | 76 |
| `/dashboard/account-support/page.tsx` | 133 | 53 | 76 |
| `/dashboard/activities/page.tsx` | 194 | 81 | 111 |
| `/dashboard/activities/[activityId]/page.tsx` | 327 | 128 | 181 |
| `/dashboard/activities/[activityId]/print/page.tsx` | 143 | 74 | 67 |
| `/dashboard/activities/[activityId]/segments/[segmentId]/microcourse/page.tsx` | 299 | 120 | 165 |
| `/dashboard/assessments/learning-matrix-preview/page.tsx` | 111 | 48 | 62 |
| `/dashboard/assessments/page.tsx` | 209 | 84 | 123 |
| `/dashboard/assessments/support-preview/page.tsx` | 111 | 48 | 62 |
| `/dashboard/assessments/[registrationId]/page.tsx` | 120 | 49 | 70 |
| `/dashboard/assessments/[registrationId]/reports/[reportId]/page.tsx` | 112 | 49 | 62 |
| `/dashboard/assignments/page.tsx` | 125 | 48 | 74 |
| `/dashboard/assignments/[assignmentId]/page.tsx` | 122 | 48 | 71 |
| `/dashboard/campuses/page.tsx` | 123 | 48 | 74 |
| `/dashboard/campuses/[campusId]/page.tsx` | 123 | 48 | 74 |
| `/dashboard/children/page.tsx` | 242 | 97 | 134 |
| `/dashboard/classes/assignments/[assignmentId]/page.tsx` | 114 | 48 | 65 |
| `/dashboard/classes/import/page.tsx` | 154 | 77 | 76 |
| `/dashboard/classes/import/roster/page.tsx` | 121 | 52 | 68 |
| `/dashboard/classes/new/page.tsx` | 248 | 114 | 128 |
| `/dashboard/classes/page.tsx` | 189 | 81 | 107 |
| `/dashboard/classes/records-detail/route.ts` | 114 | 48 | 65 |
| `/dashboard/classes/review/page.tsx` | 111 | 48 | 62 |
| `/dashboard/classes/[classId]/page.tsx` | 338 | 172 | 154 |
| `/dashboard/communication/page.tsx` | 205 | 87 | 112 |
| `/dashboard/communication/worklists/page.tsx` | 180 | 85 | 92 |
| `/dashboard/coordination/page.tsx` | 111 | 48 | 62 |
| `/dashboard/courses/new/page.tsx` | 147 | 70 | 76 |
| `/dashboard/courses/page.tsx` | 113 | 49 | 63 |
| `/dashboard/courses/[courseFamilyId]/microcourse-settings/page.tsx` | 157 | 70 | 86 |
| `/dashboard/courses/[courseFamilyId]/microcourses/[courseId]/page.tsx` | 188 | 106 | 78 |
| `/dashboard/courses/[courseFamilyId]/page.tsx` | 215 | 107 | 104 |
| `/dashboard/courseware/lectures/[lectureId]/page.tsx` | 256 | 111 | 129 |
| `/dashboard/courseware/microcourse-reviews/[reviewCycleId]/page.tsx` | 150 | 50 | 92 |
| `/dashboard/courseware/page.tsx` | 182 | 106 | 72 |
| `/dashboard/courseware/review/page.tsx` | 130 | 56 | 71 |
| `/dashboard/courseware-assets/page.tsx` | 153 | 84 | 65 |
| `/dashboard/courseware-assets/[assetId]/page.tsx` | 170 | 84 | 77 |
| `/dashboard/coursework/page.tsx` | 122 | 48 | 73 |
| `/dashboard/data-maintenance/page.tsx` | 124 | 48 | 75 |
| `/dashboard/finance/page.tsx` | 165 | 83 | 81 |
| `/dashboard/history-import/page.tsx` | 118 | 52 | 65 |
| `/dashboard/history-import/test/page.tsx` | 117 | 54 | 62 |
| `/dashboard/layout.tsx` | 111 | 48 | 62 |
| `/dashboard/leads/page.tsx` | 136 | 63 | 72 |
| `/dashboard/learning/classes/page.tsx` | 208 | 109 | 85 |
| `/dashboard/learning/classes/[classId]/page.tsx` | 208 | 109 | 85 |
| `/dashboard/management-analytics/page.tsx` | 111 | 48 | 62 |
| `/dashboard/notifications/[deliveryId]/page.tsx` | 112 | 48 | 63 |
| `/dashboard/organization/page.tsx` | 123 | 48 | 74 |
| `/dashboard/overview-detail/route.ts` | 148 | 77 | 70 |
| `/dashboard/page.tsx` | 281 | 139 | 122 |
| `/dashboard/progress/page.tsx` | 240 | 97 | 132 |
| `/dashboard/registration-settings/page.tsx` | 113 | 48 | 64 |
| `/dashboard/renewals/growth/page.tsx` | 133 | 59 | 73 |
| `/dashboard/renewals/page.tsx` | 155 | 66 | 88 |
| `/dashboard/renewals/signals/page.tsx` | 133 | 59 | 73 |
| `/dashboard/renewals/[opportunityId]/page.tsx` | 133 | 59 | 73 |
| `/dashboard/schedule/page.tsx` | 256 | 117 | 129 |
| `/dashboard/sessions/[sessionId]/microcourse/page.tsx` | 299 | 120 | 165 |
| `/dashboard/sessions/[sessionId]/page.tsx` | 375 | 163 | 177 |
| `/dashboard/staff/page.tsx` | 138 | 51 | 86 |
| `/dashboard/students/confirm/page.tsx` | 120 | 54 | 65 |
| `/dashboard/students/entry-detail/route.ts` | 114 | 49 | 64 |
| `/dashboard/students/groups/page.tsx` | 118 | 48 | 69 |
| `/dashboard/students/import/page.tsx` | 152 | 67 | 81 |
| `/dashboard/students/page.tsx` | 214 | 95 | 113 |
| `/dashboard/students/review/page.tsx` | 111 | 48 | 62 |
| `/dashboard/students/[studentId]/page.tsx` | 214 | 90 | 116 |
| `/dashboard/system-health/capabilities/page.tsx` | 120 | 48 | 71 |
| `/dashboard/system-health/page.tsx` | 143 | 71 | 71 |
| `/dashboard/targets/page.tsx` | 113 | 49 | 63 |

## API 补集

以下 API 纳入保守扫描；包含独立 webhook 等非 Dashboard 首屏请求。

| API | 可达调用点 |
| --- | ---: |
| `/api/courseware-preview/releases/[releaseId]/pages/[pageDocId]/route.ts` | 47 |
| `/api/csp-report/route.ts` | 0 |
| `/api/cw-h5/fixture/route.ts` | 0 |
| `/api/cw-h5/fixture/runtime/[...path]/route.ts` | 0 |
| `/api/cw-h5/[...path]/route.ts` | 0 |
| `/api/health/route.ts` | 0 |
| `/api/integrations/webhooks/[provider]/route.ts` | 2 |
| `/api/microcourse-h5/[artifactId]/route.ts` | 4 |
| `/api/teacher-microcourses/[courseId]/quick-preview/route.ts` | 6 |
| `/api/tools/cube-structures/drafts/route.ts` | 8 |
| `/api/tools/scenes/route.ts` | 8 |

## 私有证据摘要

UTF-8 文本按 LF 归一化后计算 SHA-256；原始文件仅保留于本机受控目录，不含在 Git 交付中。

| 文件 | SHA-256 |
| --- | --- |
| `final-query-inventory.json` | `e3378dce15f1dbcee519ce227fc1451337e14e22fc63f929655d663dd259bde1` |
| `production-baseline.json` | `ff2f250c7bc7a51fcc95a4284bcd0bc43855bf9a7d0d40c7d4187286887b6db5` |
| `production-plans-before.txt` | `c77a5ae70ae755605ce2c53312b6b65fd0df1f6c836eac9068024762b6b3a3a9` |
| `production-policy-plan.txt` | `41f18c8140ca0026274298df7e76e8e849d559fa3b68c5007f7787c3565292e2` |
| `production-asset-plans.txt` | `97c484b2b65309049685a8f27b4d7caf1d07168d5c0f41c391cf0cfbdab06f4d` |
| `production-asset-variants.txt` | `70deb4c805854341f4b2a351b6177fef9588d2c8a4c0c045413a58b1b3091519` |
| `asset-equivalence.json` | `9146dc97b313a2675089095e51eb265658466d945de46bdc0b1d8eeecff292a2` |
| `progress-equivalence.jsonl` | `dc4e0d1d1f25d532e5afc725013043855548fb2aa792cd7c6aac195f9c5a6f2a` |
| `production-asset-ui-plans.txt` | `80eb980a1e210d80df90a0d99813f2201c7ded966297f94d57573799b4cf1cfe` |
| `http-smoke.json` | `03abcb7c68162cf671748595fc3a8d06f0035c3b5f41aba1a8a7b57d12afac28` |
| `dashboard-query-local/check.json` | `fa686afcb1d6a47a7b5b96837c01c7dafa04609dca703bbefe94bbf1d243e803` |
| `dashboard-query-local/apply.json` | `9098601638e2d355c14a008737434b8dd19fda712b6c9a26f48efb9ac44d3f5c` |
