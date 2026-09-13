# 2026-09-13 笔迹代码复查与同类实现对照

状态：源码审阅与合成输入复算完成，应用保持 `a31de69e`，未进行大屏实测、浏览器自动操作或生产访问。阶段保持 R1-Live-2。

## 结论与边界

用户暂时无法在大屏对照体验，要求尽量从代码复查，并参考 perfect-freehand 的其他实现。本次确认的改进点集中在最新点显示、压力数据与采样、绘制范围及保存后笔锋一致性。`streamline=0.5` 是可调的几何因素，现有证据不足以把它或 RAF 单独认定为现场延迟主因。

前一轮“7.4 px → 0.9 px”只描述固定点距合成直线的中心线偏移，不是输入到显示计时。保留 0.5、配合当前已有的 `last=true`，2/10/20 px 三种点距样本的末点中心线偏移均为 0。是否继续降低平滑，应依据字迹质量，而不把低系数当作低延迟的必要条件。

## 参考实现

审阅时固定版本：Excalidraw `afa3a653fc5d2b742adcbd5a6063187b056d2419`；tldraw `ffd1e744a5b49a15d1db9f546ca97c8422eae0ac`。tldraw 已维护演进后的同源 freehand 实现，其参数与内部算法需一起理解，不能直接视为本仓 npm 1.2.3 的等价配置。

| 参考 | 已核对做法 | 对 Mathin 的启发 |
| --- | --- | --- |
| [Excalidraw 输入合批](https://github.com/excalidraw/excalidraw/blob/afa3a653fc5d2b742adcbd5a6063187b056d2419/packages/excalidraw/reactUtils.ts#L21) | 移动处理包装为每帧一次；[手写入口](https://github.com/excalidraw/excalidraw/blob/afa3a653fc5d2b742adcbd5a6063187b056d2419/packages/excalidraw/components/App.tsx#L10685)使用该包装 | RAF 合批本身是正常选择；重点查是否叠加调度、漏掉末点或发生超时工作 |
| [Excalidraw 可变宽笔刷](https://github.com/excalidraw/excalidraw/blob/afa3a653fc5d2b742adcbd5a6063187b056d2419/packages/element/src/shape.ts#L1205) | 调用 perfect-freehand，区分真实/模拟压力；保留 thinning、easing、可配置 streamline，并使用 `last=true` | 自然粗细、轨迹平滑与笔尖位置可以分别处理；当前恢复自然笔锋及对齐末点的方向可以保留 |
| [Excalidraw Canvas 绘制](https://github.com/excalidraw/excalidraw/blob/afa3a653fc5d2b742adcbd5a6063187b056d2419/packages/element/src/renderElement.ts#L436) | 从 ShapeCache 取形状，通过 Path2D 填充 Canvas | Canvas 路线可以继续使用；无需为了跟手直接迁移到 SVG |
| [tldraw 小距离点处理](https://github.com/tldraw/tldraw/blob/ffd1e744a5b49a15d1db9f546ca97c8422eae0ac/packages/tldraw/src/lib/shapes/draw/toolStates/Drawing.ts#L90) | 小位移设置 mergeNextPoint，随后仍更新笔画；[合并时替换末点位置](https://github.com/tldraw/tldraw/blob/ffd1e744a5b49a15d1db9f546ca97c8422eae0ac/packages/tldraw/src/lib/shapes/draw/toolStates/Drawing.ts#L656)，并保留压力 | 控制存储点数时，实时笔尖仍应跟随最新输入；已广播的历史点和可修改的预览末点需要分开管理 |
| [tldraw 笔刷设置](https://github.com/tldraw/tldraw/blob/ffd1e744a5b49a15d1db9f546ca97c8422eae0ac/packages/tldraw/src/lib/shapes/draw/getPath.ts#L17) | 模拟压力使用约 0.64～0.74 的 streamline，真实压力使用 0.62，并分别设置 easing/thinning | 高于 0.5 的参数也用于成熟实现；书写效果由整个输入与轮廓流程共同决定 |
| [官方示例轮廓路径](https://github.com/steveruizok/perfect-freehand/blob/main/packages/dev/src/state/shapes/draw.tsx#L228) | 将输出轮廓连接为二次曲线路径 | Mathin 当前用直线连接轮廓点，尚有边缘圆润度的优化空间；可以直接使用 Canvas Path2D 的曲线方法 |

## 本仓发现

### 1. 最新的小位移点会停留在缓冲区

位置：`src/features/whiteboard/board-input-sink.ts:112–138`。

当前 0.75 CSS px 重采样阈值把距离不足的最后一点放回 pending；这次 RAF 已结束，若没有新事件，该点直到 finish 才输出。实际类的可控调度复算：

- 起点 (0,0)，移动到 (0.4,0)，执行一帧后没有输出新批次，也没有待执行 RAF；收笔后才输出 (0.4,0)。画面仍有此前立即画出的起点。
- 一批输入 (10,0)、(10.5,0)，本帧输出止于 (10,0)，最新的 0.5 px 尾部尚未显示。

这是可确认的实时末点滞留，距离受阈值约束，不能用它解释大幅拖后。建议保留用于归档/同步的稳定点，单独更新实时尾点；简单地反复重发所有小位移会增加采样密度并改变模拟压力，应一起处理。

### 2. 自然粗细受采样密度影响，真实压力在入口丢失

位置：`CanvasSurface.tsx:288–304`、`board-input-sink.ts:1`、`strokes.ts:45–56`。

直接输入、Smart 及 H5 共同端口最终只保留 x/y；没有 pressure、timeStamp 或压力来源。新笔刷固定 simulatePressure=true。模拟算法基于相邻点距，因此其“速度感”依赖输入频率，不能等同于真实物理速度。

用当前 classroomInkOutline 复算同一条长 600 CSS px、持续 1 秒、标称宽 12 px 的水平线，只改变采样数量：

| 合成采样率 | 点数 | x=300 的轮廓宽度 |
| --- | ---: | ---: |
| 60 Hz | 61 | 6.3994 px |
| 120 Hz | 121 | 13.3966 px |
| 240 Hz | 241 | 16.8932 px |

这些是输入模型，不是大屏采样率实测。它说明同样动作在不同采样源上可能出现不同粗细。保留 coalesced 点有助于路径完整，不能因此删除 coalesced 数据来追求一致；应设计稳定的模拟压力输入，并为能提供有效压力的设备保留真实压力支路。普通触摸/鼠标继续模拟压力。新增压力字段需要版本化同步、归档、克隆与擦除合同配套。

### 3. 活动画布每次整体清除；直接输入仍在每个事件读布局

位置：`CanvasSurface.tsx:106–139`、`:288–298`、`:392–399`。

当前每帧 clearRect 覆盖完整 draft，然后重算当前整笔。完成笔画已留在 base，普通移动不重算全板，这是应保留的优化；当前整笔点列的压力连续性也应保留。可进一步只清除“上一轮活动笔画范围与本轮范围的并集”，并覆盖端帽、抗锯齿及远端活动笔画。原先独立截取 12 点尾段会重置算法状态，应避免重新引入。

直接输入在 sink 检查 pointerId 之前就调用 eventPoints、getBoundingClientRect 和游标广播。Smart 路由已在起笔冻结几何范围，直接输入可参考同一思路，并明确处理滚动、尺寸变化与取消。布局读取是否触发强制布局、整画布清除是否成为 GPU 瓶颈，仍需运行时证据；本次只确认这些工作的执行范围。

### 4. 保存抽点改变模拟压力，造成重放笔锋变化

位置：`src/features/classroom/checkpoint/codec.ts:62–103`。

当前压缩按中心线路径做 RDP 抽点，未保留压力或宽度。对可变宽笔刷，即使一条直线的中心线完全保留，减少点数也会改变模拟压力。

实际编解码复算：一条合法 4000 点水平线，3840×2160 逻辑画布、标称宽 12 px，相邻距离约 0.7682 CSS px，满足输入层距离阈值。序列化体积 164,870 bytes 超过 160 KiB 目标，保存阶段压成 2 点/193 bytes；重新解析成功，但同一截面轮廓宽度从 19.3245 px 变为 4.8635 px。

这是大笔画/超限保存时的笔锋一致性问题，不能解释空白页第一笔延迟。下一步应让压缩理解笔宽/压力，或采用保留笔锋信息的版本化表示；不能把仅有中心线端点一致视为视觉保真。

### 5. 写端缺少与读端一致的单笔点数上限

位置：`CanvasSurface.tsx:335`、`checkpoint/codec.ts:94–120` 与 `checkpoint/parse.ts:37`。

输入点持续追加；编码器主要按字节限制压缩。4001 点、约 42 KiB 的合成笔画可完成 checkpoint 生成并保留全部点，随后 flattenCheckpointChunks 立即报 CHECKPOINT_ITEMS_INVALID，因为读端单笔上限为 4000。

这是已复现的编码/读取合同不一致，不代表发生了实际生产丢失。[既有现场汇总](classroom-ink-latency-analysis-20260912.md)最大单笔为 155 点，此项不解释该次首笔现象。参考 tldraw 的长笔画分段思路时，需保留一笔一次撤销和稳定的模拟压力状态，并让输入、写入、读取使用统一的点数合同。

### 6. 已确认没有阻塞本地显色的路径

- 新笔起点已在 beginGesture 立即绘制；后续移动直接更新 strokeRef 与 Canvas，普通画笔没有每点写 React state/持久 store。
- 本地 drawItem 不等待网络或 IndexedDB。useClassBoard 的 50 ms 是远端进度发送周期；SessionEventLog.sendFx 只发送传输消息，不把它变成教师本机的刷新周期。
- 保存 checkpoint 的 Worker 与提交后持久化应继续保留，不能为了跟手合并到逐点绘制中。
- 直接 Canvas 书写路径只有一层应用代码中的 BoardInputSink RAF 合批，尚无证据证明固定额外等待一帧。[Chrome 输入调度说明](https://developer.chrome.com/blog/aligning-input-events)也说明连续输入可在 RAF 回调之前投递；此结论不外推到 H5 跨 iframe 转发的总等待。

## 后续增量顺序

1. 先把稳定采样与实时尾点分开，修正最新点滞留；提前筛选当前指针，并复用本笔几何信息。保留自然粗细和整笔压力连续性。
2. 修正自然笔迹保存保真与单笔点数合同，再扩展真实压力/时间信息；这些是代码层即可验证的行为，不依赖大屏实时对照。
3. 对活动轮廓使用局部清除及曲线连接，分别检查绘制范围和轮廓偏差。Canvas 低延迟上下文、GPU 合成、预测点等仍作为需要真实浏览器证据的后续方向。

本轮是复查交付，应用参数和绘制逻辑保持原样。大屏的实际输入到显示主因仍未测定，但上述已确认问题可以在本地用合成输入推进验证。

## 复算

从仓库根目录运行 `node docs/evidence/r1/classroom-ink-code-review-20260913.mjs`。脚本转译并调用本仓实际 TypeScript 模块和已安装的 perfect-freehand；调度器可控，输入为合成数据，不访问服务。已复算末点滞留、采样密度笔宽、0.5+last、抽点后笔宽及单笔上限合同。脚本是本次审计诊断，不加入日常回归 Gate。
