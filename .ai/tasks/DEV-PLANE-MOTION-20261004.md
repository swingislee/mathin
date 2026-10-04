# 平面运动连续操作

- 目标：补齐获批 24 的按份数绕点重复；对应点从真实几何派生；旋转与翻折直接手势连接同一数学终点。
- 分支：`codex/plane-motion-repeat-codex`，复用已完成线网任务的干净工作树，从本次 main 登记建立。
- 范围：registry 中独占的 `plane-construction` model/scenes/motion/README 与专属用例、夹具、交接。
- 版本：沿用 `20-create` v2。重复生成真实独立副本；继续使用现有对象和顶点上限。对应点复用 ghost/vertices，投影只用于表现，不作为准确状态保存。旧版读取保持。
- 同步：共享接线和 control-inventory 由 root 集成；本 worker 不执行数据库、服务或浏览器操作。
- 当前事实：只读设计已完成，开始实现。图形分类修复 `e8ff6fb7` 必须保留。教学手感待人工确认。
