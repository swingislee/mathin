# 恢复线索页小地推导入入口

- 目标与范围：恢复小地推导出 Excel 导入线索的可发现入口。原数据收件箱、Excel 解析、逐行匹配和导入动作仍然存在，本次接回现有流程。
- 分支及负责文件：`main`；`src/features/school/source-worklist/Page.tsx`、`Workspace.tsx`、`src/app/[locale]/dashboard/students/import/page.tsx`；共享中英文文案与任务登记只修改本任务部分。
- 已实现：线索页命令区增加“小地推导入”，按原有 `student.import` 权限显示，打开默认选中“小地推 Excel”的数据收件箱。从该入口进入时，页头返回及面包屑返回线索。
- 开发入口：`http://192.168.5.213:3130/zh/dashboard/leads`；直接导入地址 `http://192.168.5.213:3130/zh/dashboard/students/import?from=leads`。
- 实际检查：三个受影响 TSX 文件 ESLint 通过，中英文 JSON 解析和新增文案核对通过，代码差异无空白错误。复用 3130 开发服务，只读请求导入地址返回 307 至登录页，保留完整导入地址供登录后返回。未运行浏览器或真实名单导入验收。
- 待人工确认：有导入权限的员工能在线索页找到入口，选择小地推 Excel 后沿用原预览、查重和确认导入流程。生产尚未部署。
