# DEV-PLANE-STRIPS-20261004 · Codex 第 01 次交接

- 发出方 / 接收方：本任务实现者 → main 集成人。
- 目的：交付已提交的方格条增量；本机数据库依赖解除后继续集成。
- 关联任务卡：[DEV-PLANE-STRIPS-20261004](../tasks/DEV-PLANE-STRIPS-20261004.md)。
- 代码 base / head：`9caaad42bf6885f1d5dc7ca3b4bbdaba05ebf571` / `3ec8964dcfcc548ad8f2fe8b9767e01ba9958520`。
- 分支 / worktree：`codex/plane-strips-codex` / `.worktrees/plane-invariants-codex`；复用本会话干净目录，保留此前分支。

## 行为与合同

- 新建面积关系使用 `18-strips` / `plane-area-relations-lesson-v4`。任意旋转、镜像或自绘三角形按所选底边生成正交方格条；逐对象保存显示开关和 4–48 的整数密度，默认 16。
- 条带按截面中点宽度取整，表示阶梯近似而非内覆盖或原三角形的精确切片。保持底与高移动对顶点时，方格数、边长及近似面积不变，各行平移；改变底长会重新计算。
- 逐级细分与准确密度共存。复制时每个非空行生成一张独立矩形材料，整组通过材料容量、最小形状、ID 与坐标校验后才加入；原形保留。复制后的矩形不保存内部网格。
- 继承 v3 的构造、拖动、动画、观察与共角操作，按真实材料 ID 恢复条带字段；旧 v1/v2/v3、只读课堂与历史冻结内容维持原合同。关闭操作后，已开启的测量读数仍显示。
- 修改 3 个条带领域文件、领域 README、catalog/contract/scene-registry/control-inventory、2 个新测试、1 个 fixture、旧版集成测试入口，以及 SQL 迁移和本机验证脚本；未改共享宿主、业务表、RLS 或依赖。

## 已有检查（可复用）

- `plane-strips.test.ts`：41 项；`plane-strips-integration.test.ts`：7 项；`plane-invariants-integration.test.ts`：17 项；按钮与策略：10 项；课堂同步：5 项；SVG 目录：5 项，共 85 个不同定向用例通过。
- 测试使用 worker 中 `node ../../node_modules/vitest/vitest.mjs run <上述测试>`；最后的读数保留补丁单独重跑受影响用例通过（其余 6 项跳过），未重复全量。
- 7 个源码入口与依赖的定向 TypeScript 检查为 0 diagnostics。包含集成测试的闭包在基线和本批均有 36 个既有诊断（Radix / PlanarWorkbench 与旧测试 Promise 类型），不能记为全库类型通过。
- 受影响 ESLint、`git diff --check`、提交前实际暂存对象隐私扫描通过。最新读数补丁的 2 个文件 lint 通过。
- 本机检查脚本的 TS fixture 加载器已验证可读取 32 个新样本和 35 个 v3 样本；SQL 对照、ACL、保存回读和事务回滚尚未运行。
- 未做浏览器控制、Playwright、截图或全量 Gate；这些机器结果不代替产品验收。

## 环境检查点与下一步

- 集成 checkout 的 3130 开发服务仍运行。本机 Supabase 的预期监听不存在，Docker engine pipe 亦不存在；只读 preflight 在监听核对处停止，尚未进行数据库写入或迁移安装。
- 已询问用户是否启动现有本机 Docker，尚未收到确认。源码暂不合入新建 v4 开发入口，保存合同未验证不记为已交付；生产未访问。
- 用户确认启动且本机服务就绪后，从主 checkout 依次调用 `node .worktrees/plane-invariants-codex/scripts/plane-strips-local.mjs --preflight`、`--check`。先核对执行主机、实际 Supabase origin、监听所属进程、Docker 网络与数据库指纹；事务检查覆盖新旧 fixture、严格输入、私有 helper ACL、固定开发教师的保存／读取／更新和回滚零残留。
- `--check` 成功且独立复核结论绑定上述 head 后才精确 `--apply`；脚本要求同一 SQL 摘要及一小时内且 schema 未变的检查凭证。生成真实数据库类型，仅合入新增两个 helper 的类型；保留其他任务内容。
- main 集成已复核源码后复用既有机器结果，只补集成新增风险和中英文 HTTP 启动检查；更新任务交付证据与面向操作的版本说明。当前 doc 04、doc 25 和 Gate 均保持。
- 未提交源代码修改：无。worker 不占用开发端口；尚未启动新服务或连接数据库。
- 人工验收 / 部署 / Gate：待开发端集成和人工验收；未部署生产，未关闭 Gate。
- 接收确认：待接收；独立复核结论和 main 的接收结果由集成人在任务卡登记，不回写本交接。
