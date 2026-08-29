# 组合课件页扩展接口

教师自建课件页统一使用 `courseware-composition-v1`，权威入口如下：

- 文档与磁贴 schema：`composition-page-schema.ts`
- 12×9 排布、碰撞让位与节点坐标同步：`composition-page-layout.ts`、`snap-grid.ts`
- 编辑画布：`CoursewareCompositionGridEditor.tsx`
- 备课/试讲/课堂共用渲染：`CoursewareCompositionStage.tsx`
- 数据库硬门：`supabase/migrations/*_courseware_composition_tiles.sql`

## 固定规则

- 背景色、背景图和已发布来源页属于页面基底，不进入磁贴布局；其余教师添加的文字、公式、图形和图片必须各有一个 `node` 磁贴。
- 游戏和单文件 H5 是组合页内的互动磁贴，不得新增独立教师游戏页或 H5 页入口。嵌入游戏复用注册的 `game-page-v1` 内容协议，但必须移除其 `layout`，禁止递归组合。
- 一页最多一个权威互动磁贴（`game` 或 `h5`）。若未来需要多互动，必须先升级课堂状态所有权、snapshot/command replay 和 `interaction-audit.ts`，再升组合页版本。
- 带已发布来源基底的页面不得再插入游戏或 H5；来源页本身可能拥有互动状态，叠加第二个互动会产生两个课堂权威写者。需要混排时新建空白组合页，把规则文字/图片和互动组件分别拼入磁贴。
- 网格固定为 12 列 × 9 行。老师只拖拽/缩放磁贴，不直接填写 `x/y/width/height`；网格线默认隐藏，只在拖拽或缩放手势期间显示。
- 数独最小区域为 8×6，H5 最小区域为 4×3，普通节点最小区域为 2×1；所有磁贴必须在画布内且不得重叠。
- H5 在 `h5-state-v1` 完成前保持课堂只读；本地编辑预览不能作为课堂同步完成的证据。

## 新增组件类型

1. 为 `coursewareCompositionBlockSchema` 增加带版本字段的 block，明确最小尺寸和持久化字段。
2. 在 `composition-page-layout.ts` 登记可接受尺寸和碰撞优先级，并为交换、整行/整列变化、无重叠补 Vitest。
3. 在 `CoursewareCompositionStage.tsx` 增加共用 renderer；不得只接 Studio 而漏掉试讲或课堂。
4. 在编辑器右侧组件面板增加插入/编辑入口，左侧仍只创建组合页或从正式课程插入。
5. 在 `document.ts`、课堂 input provider、`interaction-audit.ts` 和 `pnpm classroom:interaction-sync:audit` 登记同步决策。
6. 升 docVersion 或 block 持久化结构时新增 migration，更新数据库结构校验、保存边界和 freeze snapshot；不得原地放宽旧合同。
