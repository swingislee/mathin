# 学生名录本机验证

适用于学生密集卡片、分组读取与选定名单进入沟通的开发增量。产品边界见[仪表盘工作入口重组 §2.1](../plan/dashboard-work-entry-restructure.md#21-学生名录与选人沟通)。

## 数据与权限

- `20260919001000_student_directory` 新增 `list_student_directory` 只读函数，沿用原学生身份索引、五阶段推导、协作范围和记录详情。
- `20260919002000_student_directory_group_order` 将缺少分组的名单置后；选定名单优先保留选择顺序。
- 仅已认证且有学生查看权限的员工可调用；每条身份仍受原学生可见范围约束。纯线索不进入名录，分组计数在分页前按学生去重。
- 服务端把完整记录缩减为卡片所需字段，向名录客户端发送电话后四位。进入沟通后通过同一权限范围重新读取所选身份。

## 本机执行

从仓库根目录运行。核对器检查执行主机、Supabase origin、监听进程、Docker 网络和数据库身份。SQL 检查只读现有固定账号可见记录，安装演练在事务中回滚；不创建或清理业务数据。私有日志保存在系统临时目录的 `mathin-student-directory`。

```powershell
node scripts/student-directory-local.mjs --preflight
node scripts/student-directory-local.mjs --check
# check 通过且存在待应用迁移时执行一次
node scripts/student-directory-local.mjs --apply

# 使用当前已核对的本机局域网 HTTP 地址，端口 3130
$env:PLAYWRIGHT_BASE_URL = '<当前本机局域网 HTTP origin>'
node --experimental-strip-types scripts/student-directory-http-local.mjs
```

HTTP 检查复用固定主管、教师和学生账号，覆盖学生与选人沟通的 zh/en 页面、默认范围、普通沟通、无效选单及匿名／学生拒绝。卡片选择、同一学生多组去重、跨页保留、缺少 `randomUUID`、保存并下一位由定向 jsdom 测试覆盖。页面视觉与交互手感仍待产品负责人验收。

迁移仅应用本机隔离开发库。生产发布按独立授权与正式 runbook 执行。
