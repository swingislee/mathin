# 组合课件接入

教师自建页使用 `courseware-composition-v1`，编辑、试讲与课堂共用内容协议和舞台。

| 对象 | 入口 |
| --- | --- |
| 文档与区块版本 | `composition-page-schema.ts` |
| 12×9 排布、碰撞与坐标 | `composition-page-layout.ts`、`snap-grid.ts` |
| 编辑 | `CoursewareCompositionGridEditor.tsx` |
| 共用渲染 | `CoursewareCompositionStage.tsx` |
| 工具版本 | `../tools/courseware/registry.ts` |
| 数据库保存校验 | `supabase/migrations/*_courseware_composition_tiles.sql` |

背景色、背景图与已发布来源页构成基底；教师添加的文字、公式、图形与图片各有 node 磁贴。游戏、H5 和工具作为互动区块与普通内容共存，使用稳定区块 ID 保存各自状态。来源游戏沿用保留键 `source`；游戏嵌入移除自身 layout，避免递归组合。

当前 12×9 网格由拖动和缩放操作，手势期间显示辅助网格。数独最小 4×4，H5/工具 2×2，普通节点 1×1。组件数量由当前非重叠布局自然决定。

新增内容类型时同步 schema、尺寸与排布、编辑入口、共用 renderer 和持久化校验。工具保存 `toolId`、`contentVersion` 及该版本允许的自包含 payload；新版本新增 migration 扩展数据库白名单。已执行迁移和冻结内容保留原语义。

每个互动区块按自己的同步协议决定课堂可写能力。只有具备可重放 snapshot / semantic command 的对象才进入相应 input provider；其他对象明确只读，同页可用对象继续工作。实例镜像通过 `GameMirrorState.instances` 贯穿编辑与课堂。

工具条负责插入，右侧承接已放置对象与属性，左侧承接页管理。产品方向见 [教学](../../../docs/workflows/teaching.md)；普通增量交付人工使用，安全与生产检查按根入口选择。
