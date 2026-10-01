# DEV-PLANE-DEEP-20261002-INTEGRATION · 平面开放材料第二批

## 目标与验收

- 用户要求继续拆分子任务深修其他平面工具，并于 2026-10-02 明确授权直接修改，无需另行联系其他会话。
- 对应 doc 04 已授权教具开发轨；产品合同见 `docs/plan/prepared-teaching-tools.md`。
- 三组独立 worker 分别实现周长、钉板与面积单位、面积关系与重叠。模板为可选起点，自定义材料继续参与数学操作。
- 先交付可操作增量，局限准确登记；既有 v1 冻结内容继续可读。生产与阶段 Gate 不在本批范围。

## 合同与环境

- root 维护共用宿主、catalog/contract/scene registry、总 SQL 校验、生成类型与任务登记；三个 worker 各用独立 worktree。
- `PlanarSceneDefinition.contextActions` 返回对象 bounds 与现有 action/operation ID；只引用已声明动作，复用侧栏回调和禁用态，不创建第二套领域操作。
- 没有空位时就近条收起；只读隐藏、忙碌禁用；空白/Esc 收起选择且保留数学结果。动作复用 `SpatialContextActions`。
- worker 只提交领域 helper migration，不执行 DB、不启动服务；root 串行负责本机 origin/监听/主机 preflight、事务验证与精确安装。3130 保留集成入口。
- 复核安排：root 复核三个已提交领域；空闲 worker 只读复核共用宿主。

## 进展

- 三组只读调研已返回。登记时原 Dashboard 批次已 integrated，无 active 文件归属冲突；历史任务不改写。
- 契约与分工先提交，再从该提交建立 worker 工作树。每个领域窄检查，集成补版本/旧内容/课堂与 SQL 对照，不跑重复全量 Gate。
- 产品验收：待验收。生产：未操作。Gate：不涉及。

## 集成交接 · 2026-10-02

- 代码集成至 `5eb1b594`，五入口 v2 与全部旧合同并存；共用快捷条及吸附闭合合同分别为 `54cf3efe`、`c81897e6`。
- root 已按提交范围复核三组领域与交接；重叠 A/B 入口经 worker 修复后接收。三个 worker 工作树保留，无业务服务或数据库占用。
- 本批定向类型、领域与宿主／课堂合同、SQL 对照／回滚、固定身份保存回读通过；本机四份迁移已安装，实际生成九个 helper 类型；五工具 zh/en HTTP 启动通过。
- 当前为 integrated／开发端已交付，待人工视觉和教学手感验收。生产未改，未做正式 Gate。完整范围、检查与下一批业务检查点见 `docs/evidence/tools-plane-deep-20261002.md`。
