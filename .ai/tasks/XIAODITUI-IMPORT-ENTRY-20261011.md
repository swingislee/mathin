# 恢复线索页小地推导入入口

- 目标与范围：恢复小地推导出 Excel 导入线索的可发现入口。原数据收件箱、Excel 解析、逐行匹配和导入动作仍然存在，本次接回现有流程。
- 分支及负责文件：`main`；`src/features/school/source-worklist/Page.tsx`、`Workspace.tsx`、`src/app/[locale]/dashboard/students/import/page.tsx`；共享中英文文案与任务登记只修改本任务部分。
- 已实现：线索页命令区增加“小地推导入”，按原有 `student.import` 权限显示，打开默认选中“小地推 Excel”的数据收件箱。从该入口进入时，页头返回及面包屑返回线索。
- 开发入口：`http://192.168.5.213:3130/zh/dashboard/leads`；直接导入地址 `http://192.168.5.213:3130/zh/dashboard/students/import?from=leads`。
- 实际检查：三个受影响 TSX 文件 ESLint 通过，中英文 JSON 解析和新增文案核对通过，代码差异无空白错误。复用 3130 开发服务，只读请求导入地址返回 307 至登录页，保留完整导入地址供登录后返回。未运行浏览器或真实名单导入验收。
- 待人工确认：生产已部署；有导入权限的员工在线索页使用“小地推导入”，选择真实 Excel 后验收原预览、查重和确认导入流程。

## 生产增量发布

- 2026-10-11 产品负责人明确授权“快速增量部署生产”。
- 已核对生产目标 Xiaomi / `mathin.club`，current 为 `20261011-072802`，源码 `c41cdcc5eff4ff3e428cb7c623f5e6fcc35fdbee`；服务及直连、Caddy 健康状态正常。
- 以该生产提交为基础，仅叠加实现提交 `2db807ba` 中的五个应用与文案文件，使用仓库发布脚本构建并切换；本次没有数据库迁移或名单导入。
- 独立生产候选为 `68b7b26869c27cf080a0e83df6548298ab681f11`，源码范围与暂存隐私检查通过。
- 18:42:29（Asia/Shanghai）完成生产切换：current `20261011-103921`，源码 `68b7b26869c27cf080a0e83df6548298ab681f11`；previous 保留 `20261011-072802` / `c41cdcc5eff4ff3e428cb7c623f5e6fcc35fdbee`。
- 首次类型检查遇到默认约 2 GB 的 Node 堆上限，构建失败时 current 未切换且生产健康。确认服务器可用内存后，仅给本次远端构建设置 `NODE_OPTIONS=--max-old-space-size=4096`，沿用原发布脚本重试；生产编译、TypeScript、静态页及 worker 打包均通过，未改运行服务的内存配置。
- 发布后服务 active、直连与 Caddy 健康正常；公网 `/api/health` 返回 200 / production，线索及导入地址均返回 307 至登录页并保留完整 next 地址。本轮没有执行真实名单导入或浏览器人工验收。
- 生产入口：`https://mathin.club/zh/dashboard/leads`；直接导入 `https://mathin.club/zh/dashboard/students/import?from=leads`。
