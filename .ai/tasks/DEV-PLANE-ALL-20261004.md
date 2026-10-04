# DEV-PLANE-ALL-20261004 · 全部现有平面工具深度优化

- 授权：用户明确「可以并行同时深度施工多个平面工具」，持续目标为「继续执行深度优化，直到完成所有现有的平面工具优化」。目标覆盖当前 22 个工具，不以某一批机器检查代替全部完成。
- 范围依据：`docs/evidence/plane-geometry-review-20260926.md` 的 49 项已获批教学能力、当前 `planar-kit/catalog.ts` 与工具局部合同。11 项历史暂缓仍保持；不自行扩大到新题库或自动评分。
- 阶段：doc 04 §5.2 开发轨，R1-Live-2 / Gate 2 不变。每个增量独立提交、集成并交付开发端，人工视觉、业务验收及生产部署分别记录。
- 实现判据：同一教学现场从右侧添加材料和观察；教师能直接建构并精确定量，默认不预置教学结论；真实数学及连续过程；保存、撤销、只读、课堂和旧版读取一致。
- 已审计总表见 [全工具证据](../../docs/evidence/tools-plane-all-20261004.md)，每个剩余缺口保留到真正实现且验证，不用保留在 legacy 的能力冒充当前入口完成。

## 本批共享合同

- 线与角新目录 `plane-lines/`，新场景 `03-create` / `plane-geometry-lesson-v2`。以可追加的线段、射线、直线、角、量角器、垂线/平行线观察为同台材料，保留 03/04/05 v1。
- 面积新目录 `plane-paper-lessons/`，`14-lessons` / `plane-area-lesson-v3`。导出 `createAreaLessonState`、`isValidAreaLessonState`、`planeAreaLessonScene`；保留 v2 与 v1。
- 路线新目录 `plane-route-workbench/`，`53-create` / `plane-grid-path-lesson-v2` 与 `54-create` / `plane-reflection-path-lesson-v2`。导出 `createGridRouteState`、`createReflectionRouteState`、`isValidRouteState`、`planeRouteScenes`；旧版不变。
- 上述领域只消费已有六键 `PlanarState`、descriptor 和指针 API。所需准确帧判定由 root 在类型与宿主集中添加，领域不复制宿主。
- SQL 文件 0300（线角）/ 0301（面积）/ 0302（路线）各自只追加严格 state/scene helper、撤销默认执行权限；0303 总分发由 root 唯一维护。worker 不连接数据库或生成类型。
- 登记、任务卡、catalog/contract/scene-registry、控制目录、宿主、集成测试和证据由 root 独占；实现 worktree 复用 `.worktrees/plane-perimeter-deep-codex` 并新开分支。原分支及缓存保持。
- 本机 DB 若需执行，只由 root 在确认主机、origin、监听与实际目标之后做定向事务回滚及精确迁移。复用 main 3130；不连接生产、不重启服务、不用浏览器自动化替代人工验收。

## 后续独立缺口

- 三角形与四边形仍为三个替换式现场：需要同台材料与自由建构。
- 周长当前入口仍缺 13 组合纸片公共边与外边界、43 阶梯/缺口边平移教学操作。
- 重叠当前入口缺 44/45 的真实圆弧交并差与圆方补集；需专门曲线几何实现，不用裁剪蒙版冒充数学面积。
- 其余审计结论按全工具表继续推进；本批不缩减持续目标。
