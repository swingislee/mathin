# 组合课件页扩展接口

教师自建课件页统一使用 `courseware-composition-v1`，权威入口如下：

- 文档与磁贴 schema：`composition-page-schema.ts`
- 12×9 排布、碰撞让位与节点坐标同步：`composition-page-layout.ts`、`snap-grid.ts`
- 编辑画布：`CoursewareCompositionGridEditor.tsx`
- 备课/试讲/课堂共用渲染：`CoursewareCompositionStage.tsx`
- 数据库硬门：`supabase/migrations/*_courseware_composition_tiles.sql`

## 固定规则

- 背景色、背景图和已发布来源页属于页面基底，不进入磁贴布局；其余教师添加的文字、公式、图形和图片必须各有一个 `node` 磁贴。
- 游戏、单文件 H5 和工具是组合页内的互动磁贴，不得新增独立教师游戏页、H5 页或工具页入口。嵌入游戏复用注册的 `game-page-v1` 内容协议，但必须移除其 `layout`，禁止递归组合；嵌入工具使用 `tool-embed-v1`。
- 游戏和 H5 可以多实例并与来源页、普通节点共存。每个游戏使用稳定磁贴 ID 作为 `GameMirrorState.instances` 的状态键；来源游戏固定使用保留键 `source`，不得把多个盘面写进同一个无实例镜像。
- H5 在 `h5-state-v1` 完成前逐块保持课堂只读；工具在各自状态未接入 `tool-state-v1` 前也逐块保持课堂只读。只读组件不得因为同页存在同步游戏就继承游戏的可写状态，也不得阻断同页其他游戏的镜像。
- 网格固定为 12 列 × 9 行。老师只拖拽/缩放磁贴，不直接填写 `x/y/width/height`；网格线默认隐藏，只在拖拽或缩放手势期间显示。
- 数独最小区域为 4×4，H5 和工具最小区域为 2×2，普通节点最小区域为 1×1；组件数没有额外产品上限，容量由 12×9 非重叠网格自然限制。

## 工具组件注册规范

- 工具课件合同的权威入口是 `src/features/tools/courseware/registry.ts`。组合页只持久化 `toolId` 与版本化 `contentVersion`，renderer 通过 `src/features/tools/components.tsx` 分发，不保存 React 组件或路由字符串。
- 新增可插入工具时，必须同时登记基础工具 registry、课件合同 registry、编辑器选择入口、共用舞台 renderer、服务端保存白名单、课堂 interaction audit、双语文案和定向测试。
- 数据库 `cw_courseware_composition_doc_is_valid` 是第二道白名单。增加工具 ID 或内容版本时必须新增 migration 更新该函数；不得只改 TypeScript registry，也不得手改已执行 migration。
- 当前 `tool-embed-v1` 使用 `tool-state-v1` 只读 provider。只有工具拥有可重放 snapshot/semantic command，并通过 `pnpm classroom:interaction-sync:audit` 后，才能把对应合同改成课堂可写。

## 新增组件类型

1. 为 `coursewareCompositionBlockSchema` 增加带版本字段的 block，明确最小尺寸和持久化字段。
2. 在 `composition-page-layout.ts` 登记可接受尺寸和碰撞优先级，并为交换、整行/整列变化、无重叠补 Vitest。
3. 在 `CoursewareCompositionStage.tsx` 增加共用 renderer；不得只接 Studio 而漏掉试讲或课堂。
4. 在舞台顶部图标工具栏增加插入入口，右侧只承载已放置组件与所选组件属性；左侧只创建组合页、从正式课程插入和重命名页签。
5. 在 `document.ts`、课堂 input provider、`interaction-audit.ts` 和 `pnpm classroom:interaction-sync:audit` 登记同步决策。
6. 升 docVersion 或 block 持久化结构时新增 migration，更新数据库结构校验、保存边界和 freeze snapshot；不得原地放宽旧合同。
