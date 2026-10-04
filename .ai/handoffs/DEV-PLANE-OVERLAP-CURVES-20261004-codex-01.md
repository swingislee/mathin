# DEV-PLANE-OVERLAP-CURVES-20261004 · Codex 第 01 次交接

- 当前结果：33/44/45 的真实圆弧区域、独立拆片与同台操作已实现，机器定向检查通过，待 root 共享接线与本地 SQL 等价核对后交付人工教学验收。
- 代码提交：`98d12ef0bda762691f0f031e4fba9c0a3f13ed20`；基线 `559c56b3eebbafcdbf445422211032f81c3901b6`。
- 分支 / 工作树：`codex/plane-overlap-curves-codex` / `.worktrees/plane-relations-deep-codex`。

## 已改范围与接线

- `src/features/tools/plane-overlap-curves/` 独立提供几何、求交、布尔闭环、状态编码、严格校验、模型、场景及 README；旧 `plane-overlap` / `plane-area` 文件保持。
- 新场景 `33-curves` / `plane-overlap-lesson-v4`，工具 ID 仍为 `plane-overlap`。导出 `createCurveOverlapState`、`isValidCurveOverlapState`、`planeCurveOverlapScene`。
- 线段与圆弧解析求交，按边界两侧布尔真值还原真实闭环；孔洞及孤立相切／分离面保留。面积是鞋带积分加真实圆弓贡献，小角采用稳定级数。没有圆的多边形替代、像素求面积或数学蒙版。
- 一圆一方为默认起点，观察关闭。可自绘圆／凹凸纸片、添加双圆／圆方材料、直接或准确改圆半径与直边顶点，明确指定 A/B。结果片保存独立边界，可继续布尔、复制、移动旋转镜像和直线剪开。
- 叶形沿真实公共弦复制为两片，支持不等半径；相切／包含／同圆不产生假弦。圆方补集得到实际四角片／四弓片。复制区域后源材料成为可恢复的轮廓参照；直线剪切则替换被剪材料，不留下实心底图。
- 移开、旋转及位置方向复位使用刚性插值，暂停帧保留真实圆弧与面积；位置方向复位保留当前镜像朝向。容量／边界失败整次保留原状态。
- `20261004031200_tool_plane_overlap_curves.sql` 新增 region/state/scene 三项 immutable 私有 helper，撤销 public/anon/authenticated/service_role 的直接执行权限。geometry helper 的内部 JSON 为 vertices/circles/counts/arcs，正式存档继续使用六键 PlanarState。
- `planeOverlapCurvesCases` 提供 57 组共享夹具，23 接受／34 拒绝，覆盖真实曲片、孔／相切孔、容量、坏弧／引用／绕序／交叉、版本及 JS trim／UTF-16 标题边界。

## 实际检查与剩余项

- 两个新增定向文件最终 28/28 通过（20 几何与合同，8 描述符、渲染、共享历史和语义运动）。包含同圆、互补半圆、相切、凹形双分量、极窄正面积叶形、圆方四片、任意弦／大圆弓、二次布尔、刚性帧、原片独立、原子容量及 LAN UUID 缺失。
- 10 个任务 TypeScript 文件 ESLint 通过；仓库配置下 noEmit 的任务文件语法／语义诊断为 0，不代替全仓检查。实际暂存范围 diff/check 与隐私扫描通过。
- 首次 Vitest 受沙箱临时缓存 rename EPERM 阻止，经正常本机定向测试授权完成；未安装依赖。中间曾修复互补半圆的边去重问题，并将解析交点的测试改为容纳 1 ULP 的数值断言。
- 未运行数据库、服务、浏览器或全量回归。0312 未安装／执行，不宣称 SQL 等价已通过。当前 integration 直接使用真实领域描述符与共享 presentation，不假造新版本注册；完整 Workbench 保存／课堂链路待 root 接线。
- Root 下一步：保留现有共享修改，注册三个导出及 v4，旧 v1/v2/v3 纳入历史读取；0313 总分发、实际数据库类型与本地 57 组 SQL 等价由 root 独占。随后提供开发入口并完成真实宿主保存／回执／晚加入定向核对。
- 人工重点：自绘凹纸片与圆相交、修改圆心／半径跨越相切；取出圆方四片、沿公共弦拆叶形、任意剪线；独立拖片后暂停旋转／复位，确认参照轮廓和孔可辨识、操作手感符合教学。
- 已完成代码提交后工作树干净。没有生产变更、用户验收结论或正式 Gate 收口。
