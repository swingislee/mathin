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
- 游戏和 H5 可以多实例并与来源页、普通节点共存。每个游戏使用稳定磁贴 ID 作为 `GameMirrorState.instances` 的状态键；来源游戏固定使用保留键 `source`，不得把多个盘面写进同一个无实例镜像。
- H5 在 `h5-state-v1` 完成前逐块保持课堂只读，不得因为同页存在同步游戏就继承游戏的可写状态；一个只读 H5 也不得阻断同页其他游戏的镜像。
- 网格固定为 12 列 × 9 行。老师只拖拽/缩放磁贴，不直接填写 `x/y/width/height`；网格线默认隐藏，只在拖拽或缩放手势期间显示。
- 数独最小区域为 4×4，H5 最小区域为 2×2，普通节点最小区域为 1×1；组件数没有额外产品上限，容量由 12×9 非重叠网格自然限制。

## 新增组件类型

1. 为 `coursewareCompositionBlockSchema` 增加带版本字段的 block，明确最小尺寸和持久化字段。
2. 在 `composition-page-layout.ts` 登记可接受尺寸和碰撞优先级，并为交换、整行/整列变化、无重叠补 Vitest。
3. 在 `CoursewareCompositionStage.tsx` 增加共用 renderer；不得只接 Studio 而漏掉试讲或课堂。
4. 在舞台顶部图标工具栏增加插入入口，右侧只承载已放置组件与所选组件属性；左侧只创建组合页、从正式课程插入和重命名页签。
5. 在 `document.ts`、课堂 input provider、`interaction-audit.ts` 和 `pnpm classroom:interaction-sync:audit` 登记同步决策。
6. 升 docVersion 或 block 持久化结构时新增 migration，更新数据库结构校验、保存边界和 freeze snapshot；不得原地放宽旧合同。
