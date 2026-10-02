# DEV-TOOLBAR-CLEARANCE-20261002 · 实现交接

- 发出方 / 接收方：Codex 实现 / root 集成；接收待主分支集成确认。
- base：`413cacef1973c2662250825e0f84498bdb2e560b`；代码 head：`9e5e1dc6d9c46e8662184438d2c5cd006fed3448`；分支 `codex/toolbar-clearance-codex`。
- 对应用户反馈：对象旁工具条偶尔遮住文字和模型；本增量先修复共用层，随后工具继续按同一合同接入。

## 行为与边界

- 平面 SVG 正式内容、空间实际可见网格／实例、表面与 Html 标签、当前工作台的面板／固定工具栏作为障碍区；优先同侧错开，再换侧，无完整空位时仅收起快捷栏。
- 已接入数位装盒、实体／骰子对象、通用积木与 Soma；空间从展示帧的实际网格取坐标，不读取旧快照来猜动画位置。
- 多行标签和截面 SVG 纳入；观察器忽略工具条自身与等值属性写入，清理后停止监听。不同工作台范围隔离。
- 数学状态、相机、保存、课堂命令、按钮终点、撤销、只读与选择合同不改。外接矩形偏保守，拥挤时快捷栏可能较早收起；侧栏继续操作。
- 后续接入规则集中在 `src/features/tools/spatial-interaction/README.md` 的“避让接入”，不另加根级通用规则。

## 定向检查

使用仓库已有 Vitest／TypeScript／ESLint。Windows 沙箱限制测试构建子进程，检查经批准执行；未绕过隐私 hook。

- `spatial-toolbar-placement`：9 项通过，覆盖六视角、缩放、窄舞台、文字错位、邻近障碍、完全拥挤。
- 最终 `spatial-toolbar-obstacles` 与 `planar-context-actions`：13 项通过，覆盖实例姿态、隐藏内容、局部 DOM、多行文字／SVG、无静止帧循环、面板遮挡收起及关闭后恢复。
- `spatial-button-interaction`、`spatial-workbench-policy`、`planar-workbench`、`place-value-box-scene`、`spatial-math-voxel-render-motion` 均通过；与上述合计 8 文件 84 项，复用未受后续两项修正影响的结果。
- 12 入口递归 TypeScript：0 诊断。所有变更 TS/TSX 的定向 ESLint 通过，`git diff --check` 和暂存隐私扫描通过。
- 未跑全量构建／全量 Gate，未启浏览器或截图。自动检查不替代真实视觉与手感验收。

## 开发环境

- 没有新增服务或数据库操作，3130 保留原集成进程。
- 本机既有依赖目录缺少若干包，DOM／lint 临时隔离补足已锁定版本后执行；项目依赖声明和锁文件未变。
- 主分支在本次代码集成前已返回 HTTP 500，确认是 PostCSS 缺包。仅向空的原依赖路径恢复锁定的 `picocolors 1.1.1` 与 `@alloc/quick-lru 5.2.0`，保留已有文件、未重启服务；原页面随后恢复 HTTP 200。本增量集成后另做页面启动检查。
- 临时依赖与验证脚本位于忽略目录；无未提交业务文件、无后台检查进程、无生产操作。

## 下一步

- root 已收到只读复核结果，集成后确认中英文代表性页面启动，再交付用户验收文字密集、相邻材料、面板开合和窄舞台。
- 覆盖、火柴棒及前批剩余关系动作仍是后续独立业务批次，本次没有宣称已扩展这些材料合同。
- 产品人工验收待完成，正式 Gate 不涉及。
