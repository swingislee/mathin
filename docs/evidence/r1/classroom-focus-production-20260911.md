# 课堂全屏与交互 · 2026-09-11 生产发布

状态：**已部署生产，机器检查通过，待人工课堂与触摸屏验收**。产品负责人本轮明确授权“将本轮改动推送生产”，并补充“包括全屏设计”。本批发布应用，R1-Live-2 与现有 Gate 状态继续沿用。

## 发布范围

- 全屏专注：课件与主板书保持 4:3，默认完整显示，可放大至屏幕全宽；双指捏合与上下移动、老师视图同步及恢复跟随已进入候选。
- 右下角工具：大小和位置以 SVG 图标展开竖向滑块，下方工具组可贴右边收起；独立学生入口位于其上方，支持移动、名单内部滚动和原有加星操作。
- Smart 与板书：站内 H5 基础 Smart、已登记拖拽区和尺规操作；触摸屏手指与手掌校准、手掌擦除及原有同步和撤销；尺规拖动在抬手、失去捕获或离开窗口时收尾。
- 常规课堂采用自适应分栏，旧分栏大小偏好读取时只保留专注模式偏好。

固定候选 `046ba7f1c7039e37ccd968d5ffbdcf7d0bab4c59`，基于实际原生产 `59553b78337eef55c66cf9525b46df16350849a1`，保留该版本的首页与列表读取优化，再叠加本任务 14 笔提交：`95b6d9da`、`9a8e3300`、`b03fd8b0`、`b576d832`、`51d79060`、`90f8f6d3`、`6dc41d81`、`0c1ec7c0`、`a4def809`、`1a1a9753`、`ed8f9633`、`3699b268`、`5e16b88b`、`fc492155`。

课堂、板书、课件运行时和滑块源码与开发端最终 `fc492155` 逐文件比较一致。候选通过源码 archive 与 Git bundle 上传至受控生产目录，远端逐项核验 SHA-256。本次没有变更依赖、数据库 schema、迁移或生成类型，也没有推送公开 Git 远端。

## 目标、构建与切换

按照[写目标策略](../../runbooks/r1-write-target-policy.md)执行只读 preflight，并在构建与切换前再次核对：SSH 主机 xiaomi，配置和运行进程的 Supabase origin 均为 `https://supabase.mathin.club`，站点为 `https://mathin.club`，应用监听 loopback 3131，运行目录与 current 一致。生产配置文件权限为 0600。

数据库指纹为 `10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`。迁移账本保持 371 条，head 为 `20260910008000_courseware_asset_list_usage`；切换前在只读事务中复核账本内容摘要。

- 本次候选的 18 个定向测试文件、113 项测试通过，覆盖全屏布局、触摸视图、同步、H5 Smart、手掌擦除、尺规输入及 UUID 缺失环境；完整 lint、类型检查和双语文案检查通过。
- Linux 生产构建与 Worker 依赖打包通过。构建后 2,835 个源码文件和 4,820 个运行时文件的密钥检查通过，构建源目录与 release 的环境文件隔离通过。
- current 为 `20260911-015309 / 046ba7f1c7039e37ccd968d5ffbdcf7d0bab4c59`；previous 为 `20260911-011826 / 59553b78337eef55c66cf9525b46df16350849a1`。
- 原子切换于 `2026-09-11T01:56:17.384232+00:00` 完成，即北京时间 09:56。应用及随其重启的 Jobs 均从新 release 运行。

应用更新沿用现有数据库与 Storage。保留上一可运行 immutable release，切换脚本配置了健康检查失败时恢复原 current、previous 并复核健康的步骤；本次切换成功，未触发回退。此前已登记的数据库恢复点 `/home/swing/services/mathin/backups/mathin-db-prechange-20260911T012103Z-read-performance-59553b78337e` 继续保留，preflight 确认 dump、TOC、manifest 与摘要文件存在。本批没有创建新的数据库备份，也没有执行数据库恢复或写入。

## 上线后检查

最终运行检查时间 `2026-09-11T01:56:35.804930+00:00`：

- loopback、Caddy 和公网 health 均为 200；Supabase 无 key 请求为预期 401，通知 Service Worker 为 200。
- 中英文登录页为 200，Dashboard 与班级入口的匿名访问均返回 307，转向对应语言登录页并保留来源地址。
- 应用与 Jobs 为 active/running、NRestarts=0、ExecMainStatus=0；工作目录指向新 release，推送监控 timer 为 active。切换后服务错误日志增量为 0，operational_errors 保持 2,017。
- 独立只读数据库核对：身份 41、班级 34、课次 429、冻结课件 release 3,774、课件页文档 77,282、Storage 对象 126,535，均与本轮 preflight 一致；迁移账本与指纹保持。

生产检查覆盖发布与运行状态。多设备跟随、全屏视觉、触摸屏校准及尺规手感继续由产品负责人在实际课堂验收。

## 证据保留

- 受控归档：`/home/swing/services/mathin/staging/classroom-focus-046ba7f1c703-20260911/evidence.tar`，包含候选元数据、测试、构建、切换、只读检查摘要与执行脚本，归档及逐文件摘要核验通过。
- evidence archive SHA-256：`c22ff8a7827d9deec129cb99c6b38b27b970ec734c7a1ac2144bc79ec5b5de72`；summary.json SHA-256：`7089ec48b3e883af382efd5e62535a43532c49f2f84b8b1aafe7d2452b5127b1`。
- 冻结源码 archive SHA-256：`ef2e3dfb66a5bf15c3734e7a6e9e31396313aa2dc45fd3def78f49394d73d077`，50,022,400 bytes；完整 Git bundle 同目录保留。
- 访问角色为生产运维维护者，至少保留至 v1.0.0 后 365 天。上一 release 与已登记的数据库恢复点继续保留。

验收入口：[班级与课次](https://mathin.club/zh/dashboard/classes)。刷新已有课堂页面，再进入“专注课件”可体验本轮全屏与交互变化。
