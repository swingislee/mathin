# 沟通与测评首屏读取优化

> 状态：开发端已交付，待人工业务与视觉验收；生产未部署，未关闭 Gate。
> 依据：2026-09-20 产品负责人反馈沟通、测评加载慢，并要求清理沟通页的旧工作批次与办理日期逻辑。

## 变更与原因

- 沟通统一按已有业务阶段和可见范围读取，移除“本轮工作／全部档案”切换与旧办理日期说明。旧 `population`、`reason` 参数不再改变名单；五阶段、搜索、范围、分页及实际联系安排保留。
- `student_list_query_facts` 原先逐人重复计算可见权限；改用请求内物化的可见身份集合。原鉴权、RLS、页内操作权限投影及写入口保持原合同。新增辅助函数禁止客户端执行。
- 内嵌首联表原先还读取未使用的重复记录提示、计算未展示的外层列筛选候选。现在省去这些工作。仅在首联、档案集合、无搜索、无排序、无额外列条件且范围匹配时走简化查询；其余查询继续走完整分支。
- 测评原先首屏展示 50 行，却向浏览器传入完整 930 行及详情。现在在服务端完成全量搜索、筛选、候选和排序后，只传当前页；详情编辑器展开时加载。输入、列条件、历史范围与翻页同步至网址，保留原显式保存动作，并修正保存后翻页时旧行序影响新页的问题。

## 测量

使用仓库固定 principal、teacher 身份。下面是本机隔离生产构建、每次禁用浏览器缓存的整页导航；从导航开始计时，等 50 行名单出现并经过两帧绘制。每组首个样本包含该账号该路由的首次访问。数据可见时间不等于所有详情已加载或全页面交互验收。

| 固定角色 | 页面 | 三次名单可见时间（毫秒） |
| --- | --- | --- |
| principal | 沟通（全部可见） | 1861 / 1614 / 1582 |
| teacher | 沟通（全部可见） | 1074 / 1098 / 1081 |
| principal | 测评 | 1082 / 1098 / 1116 |
| teacher | 测评 | 1082 / 1082 / 1080 |

同机生产构建在最后一条简化查询前，principal 沟通为 2537 / 2196 / 2146 毫秒。数据库对照中，管理员首联全部范围为 1197 → 563 毫秒；名单仍为 2278 条。前一条权限集合优化对受限员工更明显，一组同范围 RPC 为 5798 → 342 毫秒。数据库计时存在本机负载波动，不能直接当作生产页面耗时。

测评开发首屏 HTML 解码体积约 2.28 MB → 0.51 MB；最终本机生产构建约 0.466 MB。相关首屏 JS 报告为 38 → 37 个 chunk，gzip 618311 → 607635 字节；主要收益来自减少首屏记录传输。基线应用源码为 `1457ccd2`，构建输出隔离于现有开发 `.next`。

**边界**：这是本机测试，不包含生产公网传输。测评底层读取器仍汇总完整授权集合，本地样本 930 行、约 110 次分批 REST 读取，约 0.2–0.4 秒；本次完成服务端分页传输，尚未改为数据库先分页再补齐详情。首联内嵌表原有列筛选仍作用于已加载名单。生产发布后仍需在实际账号、网络下验证硬刷新与切页。

## 检查与本机应用

所有数据库操作先经 `openHistoryLocalTarget` 核对本机主机、实际 Supabase origin、监听进程、Docker 网络和数据库标识，均指向隔离开发库。没有连接生产执行迁移或业务写入。

```sh
node scripts/communication-scope-reads.mjs --check
node scripts/communication-scope-reads.mjs --apply
node scripts/communication-first-contact-page.mjs --check
node scripts/communication-first-contact-page.mjs --apply
```

- `20260920220000_communication_scope_reads`：11 个固定身份及匿名的全量可见／可写判断逐条等价；24 组完整页面 JSON 等价；撤销角色、移除协作、停用、锁定、要求改密五类事务状态共 10 组页面对照通过。
- `20260920224000_communication_first_contact_page`：63 组对照通过，覆盖所有固定身份与匿名、四类范围、20／50／100 行、末页、英文、搜索、列筛选、排序、旧工作集合及无效参数。简化分支仅省略未消费的 facets，其他返回字段完全一致；回退分支完整 JSON 一致。
- 两条迁移分别通过事务回滚零残留检查，并保存原函数回退脚本后应用本机。业务表摘要、策略、关系 ACL/RLS、函数权限／属性及无关函数保持一致。
- 定向测试覆盖全量筛选后分页、页外搜索、全局候选、快速输入合并、浏览器后退、旧沟通参数清理和保存后翻页；既有测评登记、草稿及首联交互检查通过。最终全项目 TypeScript、相关 ESLint、`git diff --check` 通过；Next.js 16.2.11 隔离 compile 构建通过。
- 开发浏览器只读检查：两个固定身份均能翻页，英文搜索空态正确，沟通主页面无旧切换文字，无页面 JavaScript 错误。未创建临时身份或写入业务登记。
- 辅助运行历史 `school-ops-phase2.test.ts` 发现两项既有失败：引用已删除的旧测评路由，以及旧历史记录队列计数期望。相关旧路径与计数函数本轮均未修改，该历史套件不记为通过；本次未扩展为全量回归或正式发布 Gate。

## 证据保留

以下证据位于本机忽略目录，仅当前开发者及获授权运维可访问，保留至 2026-10-20。摘要按 LF 归一化 SHA-256；共享记录不包含账号密码、登录状态、个人资料或学生截图。

| 私有文件 | SHA-256 |
| --- | --- |
| `.tmp/communication-scope-reads/check.json` | `17a1206dac6a884f481b98c08255f22d4cfef886caccec0e3b157093199797de` |
| `.tmp/communication-scope-reads/apply.json` | `a2a5030226661ab42a8598e745a99389628c2e7458020793fb9c6af60a104284` |
| `.tmp/communication-first-contact-page/check.json` | `24c8da40975e3db71e033b35bd5530ccdd0c6fcf1a82b961d453d0177fc47814` |
| `.tmp/communication-first-contact-page/apply.json` | `88b9d32f09051091c714503e1da7ee567ccc237a116046850a077f4796af0d2f` |
| `.tmp/communication-assessment/hard-refresh.json` | `449ecc07fe8387debb2a84200a99b5ca81e5afad19c58ec038ebb319c302f02c` |
| `.tmp/communication-assessment/production-pages.json` | `41eecb7f3b351a5b2ada8dce78e80ad2f4e40964d114ebbd49b2a677dd3bad54` |
| `.tmp/communication-assessment/bundle-before.json` | `9e105ed48a8a236306a97572cf3f303789cc4d600162663ae991cd5ad07f085c` |
| `.tmp/communication-assessment/bundle-after.json` | `956a70a656cac46ea78b30ef2600ebc2f5ffd6ff1c453fe30d1324920a43055d` |

开发验收：[沟通](http://192.168.5.213:3130/zh/dashboard/communication)、[测评](http://192.168.5.213:3130/zh/dashboard/assessments)。
