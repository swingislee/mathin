# DEV-PARENT-IOS-NEXT-20261001 · iOS 家长端共用 Next.js 接口升级

- 用户 2026-10-01 明确要求：iOS 沿用与拓展现有 Supabase 后端；需要升级的接口用 Supabase 与 Next.js 子 agent 同步更改。
- 上游主任务：[iOS 家长端](DEV-PARENT-IOS-20261001.md)，doc 04 §5.2 用户选入开发轨。
- 数据沿用现有表、账号主体、亲子关系和 RLS；不创建新业务表，不触碰生产，不创建测试身份。
- 先互相确认现有表/RPC、字段、亲子权限和 DTO，再做必要的增量；不复制业务事实、不把虚构数据作为服务器响应。
- Supabase lane 核对数据与权限，必要时只提交基于现有表的增量 SQL；Next.js lane 维护 API、共享类型、既有调用方兼容及窄测试。
- 子 agent 使用登记的独立 worktree，提交自己的范围并回报 base/head、测试、风险和局限；集成由主 agent 串行完成。
- 本轮不执行数据库写入或 migration；需要时先返回明确理由与开发目标 preflight 信息。
- Windows 上运行与变更相关的静态/单元检查。已存在后端、网页与微信合同继续可用；Mac 构建与人工验收另记。
