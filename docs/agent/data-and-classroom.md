# 数据、鉴权与课堂同步规则

> 读取条件：任务涉及数据库、Supabase、鉴权、RLS、Server Action、测试身份、课程发布或课堂互动状态。专题事实以 `../plan/03-data-and-tech.md` 和当前领域规划为准。

## 身份与授权

- 顶层身份只有 `student | parent | staff | admin`；教师、教务、教研、学辅、销售等属于 staff 岗位/权限，不得新增平行顶层角色。
- 受保护页面统一调用 `src/lib/auth.ts` 的 `requireUser(locale)`，内部使用 `supabase.auth.getUser()`；未经专门鉴权迁移不得绕过、复制或替换。
- 服务端授权禁止信任 `getSession()` 返回的用户。`src/proxy.ts` 只刷新 Cookie 并做乐观跳转，真实授权依赖数据库 RLS。
- 登录/注册 Action 位于 `src/app/[locale]/(auth)/actions.ts`，其 `next` 参数必须防 open redirect；OAuth/邮箱确认回调位于 `src/app/[locale]/auth/callback/route.ts`。浏览器、服务端和环境校验分别复用 `src/lib/supabase/client.ts`、`server.ts` 和 `config.ts`。
- 前端隐藏按钮不构成授权；新增读写同时检查 RLS、角色 scope、失败码和审计边界。

## Server Action 与数据输入

- Server Action 入参必须通过 zod schema；禁止在 Action 体内散落 `String(...)`、`Number(...)`、`Date.parse` 等手写 coercion。
- schema 与 Action 同文件；共享金额、文本、日期、UUID 原语复用 `src/features/school/actions/schemas.ts`。
- 校验失败返回 `{ ok: false, code: "VALIDATION" }`；只拒绝畸形输入，不借校验层改变业务规则。搜索串等非持久化输入可截断。
- 新增受保护数据页同时遵守 `frontend.md` 的异步 Request API 与 Suspense 边界。

## 测试身份与正式数据

- 本机隔离 Supabase 复用 `.claude/test-accounts.local.md` 或当前 gitignored manifest 中的固定开发身份；不得为常规验证创建一次性账号，也不得把开发身份同步到 Xiaomi。
- 需要未认领绑定码、多子女家长、越权等现有身份无法覆盖的场景时，先向产品负责人确认新增测试身份。
- 正式身份及真实班级、课次、学生、考勤、冻结 release/snapshot 都是受保护业务事实。清理只能在隔离副本演练，或按已授权 manifest 精确处理显式测试根；不得使用“只留一个 auth 用户”的旧假设。

## 自研课堂互动同步门

- 新增或修改 Mathin 自研游戏页、单文件 H5、空间/3D 文档或其他课堂 renderer 时，必须在 `src/features/classroom/sync/interaction-audit.ts` 声明版本化同步 provider；`interactive=true` 或本机可点击不等于课堂同步。
- 教师控制态只有一个权威写者。可恢复动作使用有 payload 上限的 durable snapshot/semantic command 并进入 session event log；相机逐帧、hover、拖动中间帧等可丢表现不能冒充权威状态。
- 展示端、学生端和晚加入端必须能从 snapshot/command replay 收敛。未实现协议的自研 H5 与 `spatial-page-v1` 在课堂中保持 read-only/fail-closed。
- 新增 `CoursewareDoc` 版本、微课 mode 或游戏课件 contract 时更新类型穷尽门，并运行 `pnpm classroom:interaction-sync:audit`。

## 数据摘要

- 写入仓库或数据库、并要跨环境复核的文本摘要必须使用 `scripts/lib/text-hash.mjs` 的 `textFileSha256` / `normalizeNewlines`；不得直接对 Windows checkout 的原始字节取 hash。
