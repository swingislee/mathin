# 2026-09-13 PF 时间压力与轮廓优化

状态：开发端已交付，待人工书写验收。当前阶段仍为 R1-Live-2，生产未部署。实现基于 `36a9dabe`，延续[鼠标复刻实验](classroom-mouse-ink-reproduction-20260913.md)，本次将实验方向接入实际课堂笔刷。

## 变化与边界

- 新书写使用 `freehand-v3`。保留原始相对时间与接触压力，不把合成压力写回 `samples`；同一输入可以独立复算。无版本、round-v1、freehand-v1、freehand-v2 继续按原规则重放。
- 鼠标、普通触摸和默认压力输入使用 `距离 / 时间 / 笔宽` 估算速度。相同速度不再因为事件密集或稀疏而直接改变线宽。匀速缩放坐标与笔宽时，估算压力保持一致。
- 速度和模拟压力各使用 24 ms 时间常数的因果平滑；单次平滑时间上限为 32 ms，防止长停顿后一帧跳变。模拟目标为 `0.18 + 0.6 / (1 + (speed × 10)²)`，慢写趋向饱满，快写趋向纤细，避免线性映射在阈值处直接截断。
- 模拟压力每段变化再限制为 `0.12 × 距离 / 笔宽`，即轮廓直径变化不超过该段距离的约 0.168 倍。静止鼠标保持线宽，停顿后的小位移平滑衔接。没有可用时间时保持已有模拟压力；不会用无时间的点间距重新引入密度依赖。
- 首个非默认有效 pen 压力出现后，后续样本使用真实压力，采用 12 ms 平滑；较小变化被减弱，持续轻重仍保留。压力缺省 0.5 的兼容策略沿用，但识别按点向前推进，不再因后段识别到压感而改写前段的压力来源。首个真实压力直接作用于起笔；抬笔沿用上一接触压力。
- 轮廓仍由 PF 1.2.3 生成，`thinning=0.7`、`smoothing=0.6`、`streamline=0.1`、`simulatePressure=false`、`last=true`。只平滑压力，不新增坐标滤波、预测点、未来样本等待或 RAF 层。这里的参数与端点检查不能换算为设备输入到显示的延迟。
- v3 的 PF 轮廓点以相邻中点间的二次曲线连接。活动层、底图、重放与导出共用 `inkOutlinePath`；曲线位于控制点凸包内，现有轮廓边界加抗锯齿余量仍能覆盖清除范围。原始左右摆动保留，曲线只减轻轮廓折角。
- 单点使用同位置重复点，保持点形居中。PF 在输入恰为两点时会自行插值二维坐标、丢失补点的压力；v3 显式补一个携带插值压力的中点，绕开该分支。起收笔继续采用圆帽、相同 `last=true` 规则，不在收笔后施加整笔收尖变形。
- `InkPressureCache` 为活动笔画缓存每点的因果压力状态与像素点。更新时查找共享前缀，只为新增或替换的尾段计算压力；替换临时预览点、编辑、缩放时从相应位置复算。缓存随活动笔画释放，未变化远端轮廓和局部清除策略继续生效。
- 类型、共享 schema、checkpoint 解析与预算处理、版本化同步 provider 接受 v3。携带压力的点列完整保存；超出既有单笔/整板预算时仍走原保存错误流程。本次未改数据库、包版本、课堂协议或正式业务数据。

## 机器检查与复算

12 个相关测试文件共 97 个用例通过，覆盖时间压力、设备压力、短点/转折/最新端点、预览回退、缓存复用、Canvas 即时起笔、LAN UUID 兜底、掌擦、Smart/H5 输入、课堂同步、checkpoint、备课批注和历史笔刷。分两批执行，重复覆盖的测试只计一次：

```text
node node_modules/vitest/vitest.mjs run tests/classroom-timed-ink.test.ts tests/classroom-pf-pressure.test.ts tests/whiteboard-palm-input.test.ts tests/classroom-ink-draft.test.ts
node node_modules/vitest/vitest.mjs run tests/classroom-timed-ink.test.ts tests/classroom-ink-draft.test.ts tests/classroom-board-checkpoint.test.ts tests/classroom-preparation.test.ts tests/classroom-interaction-sync.test.ts tests/classroom-natural-ink.test.ts tests/classroom-round-ink.test.ts tests/classroom-input-router.test.ts tests/whiteboard-smart-input.test.ts tests/classroom-h5-pointer-bridge.test.ts
```

受影响文件 ESLint 与 diff 空白检查通过。全库 TypeScript 仍只有既有的 `tests/teacher-workspace-entry.test.ts:31` TS18048，本次没有改动该文件。共享类型变更经上述定向合同检查，未追加全量构建或发布 Gate。

开发健康接口在回环与当前局域网入口均返回 200，响应为 development。监听进程查询在当前沙箱被拒绝；复用了现有服务，没有启动、重启或数据库操作。内置浏览器可列出原试讲标签页，但读取 DOM/控制台时超时；未刷新、覆盖原页，也未据此宣称页面热更新或大屏手感已验证。

复算沿用原实验的六类合成鼠标轨迹，使用本次实际 `drawItem` 与 `InkDraftRenderer`。新脚本会核对每类预览和底图的路径命令一致，并验证 581 帧压力缓存与完整重放一致：

```text
node docs/evidence/r1/classroom-mouse-ink-reproduction-20260913.mjs <输出目录>
node docs/evidence/r1/classroom-timed-ink-comparison-20260913.mjs <同一输出目录>
```

脚本：[classroom-timed-ink-comparison-20260913.mjs](classroom-timed-ink-comparison-20260913.mjs)。输出含 `v3-report.json`、`v3-comparison.svg`；图及原始样本保留在线程本地受控产物目录，不放仓库。数值为基准笔宽 4.548 CSS px、笔画中段 y=68.25～228.25 的水平截面，排除端帽；曲线按控制多边形长度不超过 0.15 px 的间隔近似。合成输入并非用户页面中的原始点列。

| 合成轨迹 | v2 中段宽度范围 | v3 中段宽度范围 |
| --- | --- | --- |
| 匀速，8 ms 采样 | 5.7375～5.8650 px | 约 5.8785 px |
| 匀速，4/16 ms 间隔交替 | 4.3894～5.2731 px | 约 5.8785 px |
| 匀速，鼠标坐标取整 | 5.5220～5.6396 px | 约 5.8680 px |
| 逐渐减速 | 2.9180～6.3171 px | 4.4942～6.2260 px |
| 匀速、小幅左右摆动 | 5.7445～6.0182 px | 5.8668～6.0304 px |
| 减速、微摆、间隔变化及取整 | 1.7568～6.1103 px | 4.5007～6.5569 px |

前两行支持“相同速度受采样间隔的影响减小”；后几行中的宽度变化同时含自然减速与轨迹倾斜，不能把范围变小全部解释为消除了噪声。模拟压力的幅度已作调整，新旧平均宽度不必相同。

本机 Node、无操作 Path2D 的长笔画探针（1000～3000 点，隔两点更新）中，v2/v3 几何处理的中位耗时约 0.1745/0.1453 ms，P95 约 0.4324/0.3363 ms。只用于检查新增压力处理的计算负担；不含真实曲线栅格化、合成和显示，不能外推为低端机器改善比例。活动 PF 本身仍随整笔点数线性重算，任意超长笔画与端到端显示延迟尚未解决。

本次复算的规范化源文件 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `src/features/whiteboard/ink-pressure.ts` | `deb451eb765c8be085d973a3cad6f6eadc369fc4666ca2abbb93b0d44c61eb9d` |
| `src/features/whiteboard/strokes.ts` | `dd2b875b815ce6e1b7da31cfbeba39a60f35617e86d8fa3f87b53e148071c1bb` |
| `src/features/whiteboard/ink-draft-renderer.ts` | `193512fde5f6705a9424e619ea7d49ed6683c990ed3bd2efed15d8f6d3d7a071` |

## 人工验收

保留现有试讲页作为旧笔迹对照，从开发端已有课次另开试讲，写新笔迹。先用鼠标写匀速长竖线、逐渐减速长竖线和停顿后继续写；再写点、短横、撇捺和“永、国、心”。比较粗细过渡、边缘、快速转折、松手前后形状及翻页重放。使用压感笔时再比较轻重、抬笔和点画。

低端 Windows Chrome / Edge 的空白页第一笔、连续快写和笔尖到显示的迟滞仍须人工验收。当前参数保留为可独立验收的一版，后续依据同设备体验调整；本记录不关闭生产 Gate，也不将自研钢笔纳入本次范围。
