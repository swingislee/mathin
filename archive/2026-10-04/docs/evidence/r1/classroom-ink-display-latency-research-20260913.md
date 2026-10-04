# 笔迹持续显示拖后的代码与社区研究

## 判断与优先级

当前最值得优先验证的是输入到呈现之间的时间延迟：浏览器收到的位置、本帧采用的位置、屏幕正在显示的位置可能对应不同的时刻。空白页第一笔就有、持续书写时拖后、慢写感觉较好，与这种机制相符。具体耗时占比尚未测定，现有证据支持调整排查优先级，尚不足以确定现场主因。

降低 perfect-freehand 的 streamline 可以减少几何跟随偏移；它无法消除事件投递、应用排队和画面呈现的等待。当前课堂笔刷已经使用 `last=true` 对齐本帧采用的中心线末点，继续压低平滑参数的收益应与字迹质量一起判断。自然粗细变化仍是验收要求。

本次新增的关键证据是：本仓使用普通透明 2D Canvas；Chromium 对低延迟 Canvas 有独立的输入及提交路径；Windows 底层低延迟资源还存在 GPU 能力条件。与此同时，Excalidraw 社区确有“同一笔迹库的示例跟手，集成应用拖后”的相近报告。两者共同支持把输入和显示路径提升到参数调整之前，但社区案例不能替代本设备的测量。[^1][^7][^8]

| 排查项 | 当前证据 | 与持续拖后的关系 | 优先级 |
| --- | --- | --- | --- |
| 输入样本年龄、浏览器与系统呈现等待 | 机制有标准讨论及 Chromium 源码支持；本仓尚无对应时序记录 | 能产生每帧都平滑、但始终落后笔尖的画面 | 首要 |
| 应用 RAF 等待及绘制工作 | 每批移动等待一次 sink RAF；每次活动绘制覆盖整张 draft | 可能增加等待或错过呈现机会，具体占比待测 | 首要 |
| 大面积透明画布与课件、浮层的合成 | 结构已确认；实际图层提升及 GPU 成本未知 | 空白板书也可能承担画布及页面合成成本 | 与显示路径一起验证 |
| 最新小位移点滞留 | 已复现，距离小于 0.75 CSS px | 是局部误差，解释不了较大的连续间距 | 独立修正 |
| 采样影响粗细、保存笔锋变化、单笔点数合同 | 已有合成输入复算 | 各有明确影响范围，与首笔持续显示拖后分别验收 | 保留登记 |

## 帧率与跟手感

```mermaid
flowchart LR
    A[实际笔尖位置] --> B[设备与系统采样]
    B --> C[浏览器投递输入]
    C --> D[应用选点与等待绘制]
    D --> E[生成自然轮廓并提交 Canvas]
    E --> F[浏览器及系统合成]
    F --> G[屏幕显示笔迹]
```

稳定帧率描述画面多久更新一次，跟手感还取决于每次更新使用的输入有多旧。即使每秒稳定更新 60 次，每帧也可能一直显示较早的落点。W3C Pointer Events 的 #204 正是围绕应用能稳定绘制、浏览器仍有机会更早补齐笔尖尾迹而提出；2019 年工作组讨论还记录了 Microsoft 对 raw 输入及预测之后剩余延迟的反馈。[^2]

短时间近似匀速直线运动时，可见拖后距离约等于“速度 × 时间延迟”，再叠加几何偏移。这是解释症状的模型，没有把当前设备的延迟假定成某个固定毫秒数。此前的“7.4 px → 0.9 px”只来自合成中心线偏移复算，不能用于代替输入到显示计时。

## 有直接参考价值的社区讨论

### Excalidraw #4802：示例与集成应用的手感差异

2022 年的讨论起于 iPad 手写体验。维护者 dwelle 表示 Excalidraw 当时采用 thinning 0.6、streamline/smoothing 0.5，但把同样参数放入示例，表现仍有差异。另一位参与者 kwetter 在 2022-10-28 报告：Obsidian 插件有拖后，缩小窗口会好一些，网页版本更流畅，而 perfect-freehand 示例几乎感觉不到延迟。[^1]

这条讨论与当前对示例的疑问高度相关，说明仅核对 npm 参数不足以判断集成手感。缩小窗口改善是值得验证画布面积和页面绘制成本的线索；该报告同时涉及笔画数量，且没有受控计时，不能据此确认 Mathin 的瓶颈或断言其原因一定是 GPU。

### Excalidraw #5192：维护者区分了整场景重绘与笔迹算法

2022-05-14，维护者 dwelle 根据该 issue 的视频，将问题归于当时每次画笔事件重画已有大量线条，并指出单纯简化形状不足以解决，还需绘制策略优化。此前事件节流曾带来性能改善。[^3]

本仓普通移动已经保留完成笔迹的 base 缓存，只更新活动 draft，因此该历史问题不能原样套用。它支持保留分层缓存，也提醒我们不要为了减少等待而无条件把整笔重算放大到每个高频输入事件。当前主症状发生在空白页，历史内容量相关的优化应与之区分。

### Pointer Events #214 与 MDN #44029：raw 输入解决投递时机

2017～2018 年的 #214 讨论既涉及等待 RAF 的延迟，也涉及给已有全局监听器突然提高频率的副作用。2026-08-14，MDN 维护讨论进一步明确：pointermove 可以为了性能延后投递，pointerrawupdate 则尽早投递；两者都可能包含合并样本。[^4][^5]

因此，`getCoalescedEvents()` 补足经过的轨迹，`pointerrawupdate` 改善拿到输入的时机，两者作用不同。当前已经读取 coalesced 点，不等于已经取得最低延迟输入。反过来，换成 raw 后仍把最新点留到同一 RAF 才画，也未必能兑现更早投递的收益。

### WHATWG #5466：desynchronized 的代价与平台差异

2020 年 kainino0x、kenrussell 的回复说明，desynchronized 放宽了与 DOM 同步呈现的保证，不同平台可采用不同实现；前缓冲路径还要考虑闪烁。讨论中的 WebGL `preserveDrawingBuffer` 建议有明确上下文，不能当作本仓 Canvas 2D 的通用参数。[^6]

该讨论帮助理解为何它是需要主动选择的模式。它不能证明 2026 年所有 Windows 设备都具备相同收益，因此本次继续核对了较新的 Chromium 源码及实际使用条件。

### 系统尾迹讨论：显示可以比应用正式笔迹更早

W3C #204 后续发展为 Ink API。其思路是应用提交自己最后画到的事件和样式，让系统补绘还没进入应用画面的短尾迹，随后由应用笔迹接替。这直接对应“最新收到的点已经画了，但仍落后于物理笔尖”的情形。该 API 当前引用版本为 2024-09-16 的社区草案，不能视为所有浏览器的共同基线。[^2][^10]

它也表明自然笔锋与低延迟预览可以分层设计。系统补绘的样式能力有限，Mathin 最终笔迹仍由 perfect-freehand 生成；临时尾迹的宽度、颜色、消退和接替必须单独验收。

## 本仓与 Chromium 的具体对应

### 默认上下文尚未选择低延迟路径

本仓 [CanvasSurface.tsx:145](D:/code/2026/2026-07_mathin/src/features/whiteboard/CanvasSurface.tsx:145) 在初始化尺寸时，通过无配置的 `getContext("2d")` 设置变换；重绘和输入函数也复用普通上下文。仓库笔迹路径未调用 `getPredictedEvents()`、未监听 `pointerrawupdate`，也未接入系统尾迹。

Chromium 源码固定在 `995b3c82e3ab8db92f978be4e49a1bd3761156f9`（2026-09-13）。这代表所审阅的 upstream main，不代表现场 Chrome/Edge 的安装版本。

| Chromium 位置 | 已确认行为 | 对 Mathin 的含义 |
| --- | --- | --- |
| `HTMLCanvasElement::GetCanvasRenderingContextInternal`，591～595 行 | 当上下文设置 desynchronized，创建相应图层，调用 `SetNeedsUnbufferedInputEvents(true)`，建立资源 dispatcher | 该选项涉及输入及提交路径，不只是笔刷运算速度 |
| `HTMLCanvasElement::PostFinalizeFrame`，711～725 行 | 对低延迟 2D/WebGL 上下文，通过 dispatcher 提交绘制资源与脏区域 | 普通 Canvas 与此路径的呈现过程应分别评价 |
| `LowLatencyUsageSupportedForCanvas2D`，149～183 行 | CPU raster 不使用该低延迟资源模式；Windows 检查 `shared_image_swap_chain` 能力 | JS 能创建上下文，与底层满足低延迟资源条件是不同事实 |

前两项见 Chromium HTMLCanvasElement 源码，第三项见 canvas_utils 源码。低延迟选项回读为 true 也不能直接证明面板上减少了多少延迟。[^7][^8]

### 单改上下文或单改事件，都会漏掉一部分链路

[BoardInputSink.push:55](D:/code/2026/2026-07_mathin/src/features/whiteboard/board-input-sink.ts:55) 将本次点列放入 pending，并安排一次 RAF。[flush:111](D:/code/2026/2026-07_mathin/src/features/whiteboard/board-input-sink.ts:111) 遍历当时全部 pending，再调用绘制回调。它没有“一帧只取一个旧点”的追赶队列；除距离阈值保留的尾点外，每次消费本批输入。

可以确认的是移动点在 RAF 回调之前不会经这条路径画出；不能仅凭这段代码推导为“固定多等完整一帧”。Chrome 的输入对齐机制会在 RAF 之前投递连续事件，实际等待取决于事件到达与帧调度的相位。[^9]

进一步的推论是：低延迟 Canvas 请求更及时输入后，如果 Mathin 仍固定等 RAF，部分更早到达的点仍会留在应用队列。对照实验应同时覆盖上下文和应用提交策略，才能区分收益来自哪里；任何提高绘制频率的方案都应限制高频路径的工作量。

### 透明覆盖与收笔交接是实际结构约束

[CanvasSurface.tsx:556](D:/code/2026/2026-07_mathin/src/features/whiteboard/CanvasSurface.tsx:556) 的层级为 base、SVG 对象、透明 draft、尺规及光标；课堂下方还承载课件。活动自然笔迹在 [redrawDraft:106](D:/code/2026/2026-07_mathin/src/features/whiteboard/CanvasSurface.tsx:106) 中先清整张 draft，再生成整笔轮廓；收笔后清空活动引用，提交 store，再由订阅将笔迹画到 base 并清 draft。

这些顺序在现有普通 Canvas 路径中已有用途。改为与其他内容不同步的呈现后，base 新笔迹可见与 draft 旧笔迹消失不一定落在同一显示帧。WICG 的设计说明正把这种活动墨迹到完成墨迹的交接列为难点，并记录了 Windows 透明硬件覆盖层的限制。该限制源于历史设计说明，本次将它作为当前设备需核对的条件，未将其外推为所有新驱动的绝对结论。[^11]

因此，候选实现需要处理清除闪烁、叠影、收笔交接和课件透出。`alpha:false` 会改变覆盖层的透明语义；它不是可直接套用的性能设置。上下文配置也必须从首次创建时生效，后续再调用带新参数的 `getContext()` 不会重建同类型上下文。[^12]

### 当前入口没有留下区分等待来源的时间信息

直接 Canvas 的 [eventPoints:292](D:/code/2026/2026-07_mathin/src/features/whiteboard/CanvasSurface.tsx:292) 与 Smart 的 [eventPoints:62](D:/code/2026/2026-07_mathin/src/features/classroom/input/useClassroomPointerRouter.ts:62) 都把输入转换为 x/y。共同端口和 sink 也只传位置。

后续诊断可以只在本地活动输入中暂存 `timeStamp`、接收时刻、本帧采用的末点时间以及对应的原始事件，保持现有持久笔迹协议。这样能直接区分“样本到达已经旧了”和“应用拿到后又等了一段”，无需先扩展保存格式、真实压力与同步合同。

系统尾迹则有额外要求：传给 presenter 的必须是同文档的可信 PointerEvent，且对应最后实际绘制的输入。H5 经 postMessage 传来的 x/y 不能通过 `new PointerEvent()` 变成可信输入；直接 Canvas、Smart、H5 的接入应分别设计。[^10]

### 已检查的其他路径

普通画笔移动通过 ref 和 Canvas 绘制；本地显色没有等待网络确认或 IndexedDB 完成。[useClassBoard.ts:218](D:/code/2026/2026-07_mathin/src/features/classroom/live/useClassBoard.ts:218) 的 50 ms 定时器发送远端进度，90 ms 限流用于远端光标，均不是教师本机的绘制周期。

直接输入会在 sink 入队之前广播光标，并读取布局，这些工作仍可纳入处理时间统计。它们可能增加主线程工作，但现有源码没有提供把某个定时周期当作持续显示延迟的依据。掌擦与双指 hook 对正常 pen 移动只维护引用集合，没有发现额外的逐笔点 React 状态更新或另一层书写 RAF。

## 能保持自然笔锋的候选方向

### 先对照呈现路径，再扩大笔刷调整

下一次代码增量宜先保留同一套 perfect-freehand 参数和真实输入点，提供范围受控的显示路径对照。先比较普通上下文与低延迟上下文，再分别比较 RAF 合批与受控的及时提交。每次只改变一个维度，记录实际生效配置、事件年龄和绘制工作；低延迟模式的清除与收笔交接先在局部实现中验证。

这能直接检验当前最关心的时间链路。当前整笔重算保证了压力连续性，提高事件频率时应避免将整笔重算无条件执行数百次每秒。缓存布局、提前排除非当前指针、缩小清除范围可以降低工作量，但各自收益需要与新增路径分开记录。

### 临时预测尾迹针对剩余的可见间距

W3C 2023 的介绍明确指出，raw 输入和 coalesced 点都具备后，绘图仍可能有感知延迟；预测点用于临时画到更靠近当前笔尖的位置，实际输入到达后替换掉预测部分。[^13]

可借鉴的是把预测留在本地活动预览：主体保留自然粗细；新实际输入到达、转折、停笔、取消时撤销旧预测；限制预测时间和距离，避免过冲。预测点不进入保存、广播、撤销历史或永久压力计算。浏览器可能返回空预测列表，回退路径仍应完整工作。

这是一种补偿方案，不等于已经消除了输入或呈现延迟。短笔、中文转折、收笔回弹和笔宽连续性是它的验收重点。不能直接恢复旧的固定 12 点截尾绘制，因为那会重新丢失整笔压力与平滑状态。

### 系统尾迹与 Worker 的位置

系统尾迹适合作为支持设备上的另一种增强，尤其值得在 Windows 上做能力验证。它应与应用自己的预测分别对照，避免两个来源同时扩展同一尾部；是否采用取决于可信事件能否接入、细笔锋衔接是否自然以及实际收益。[^10][^11]

OffscreenCanvas/Worker 可在主线程确实繁忙时隔离工作，但它会引入输入传递和渲染所有权变化。当前没有现场主线程耗时证据，故排在呈现路径、输入年龄和局部工作量之后。它不能单凭架构名称解决事件到达之前或面板刷新中的等待。

## 诊断指标与验收边界

| 记录项 | 用途 | 解释边界 |
| --- | --- | --- |
| pointerType、实际事件频率、每事件 coalesced 点数 | 区分系统将笔识别成 pen、touch 还是 mouse，以及输入密度 | 桌面光标轨迹不等于物理笔尖轨迹 |
| 原始样本时间、处理函数进入时刻 | 估计浏览器提供的样本到应用处理的年龄 | 时间戳语义、精度与时间原点需核对；不能直接测出完整硬件链路 |
| sink 入队、批次开始、本帧最后实际采用的样本时间 | 计算应用内等待和选点新鲜度 | 应读取实际执行时的时钟，不能把 RAF 回调参数当作当前执行时刻 |
| 轮廓生成与 Canvas 提交耗时、帧间隔 | 区分算法工作、主线程停顿和错帧迹象 | Canvas 调用返回与像素上屏是两个时刻 |
| 上下文实际属性、CSS/像素尺寸、DPR、输入路由 | 保证对比条件可解释 | 属性支持与底层硬件优化生效分别记录 |
| 日后同设备实际笔尖与可见笔迹对照 | 验证持续书写时的最终跟手感 | 需要真实输入及显示观察；合成事件或算法微基准不能替代 |

统计宜在内存中限量采样、结束后汇总，避免逐点更新 DOM 或打印大量日志改变被测路径。RAF 回调参数由同帧回调共享，与回调内执行 `performance.now()` 得到的时刻不同，应用排队计时应使用实际进入回调时的时钟。[^16] 没有大屏实时对照时，可以推进代码合同和局部时序诊断，最终的物理输入到显示结论仍保留为待测。

还有两个容易影响判断的条件：

1. **局域网 HTTP 与 HTTPS 的输入能力不同。** Pointer Events Level 3 于 2026-06-30 成为 Recommendation；其中 getCoalescedEvents 和 pointerrawupdate 受安全上下文约束，getPredictedEvents 的 IDL 没有同样的标注。现有可选调用可在不支持时回退，但开发局域网 HTTP 不能默认与 HTTPS 得到相同输入流。实际可用性及返回值都要记录。[^14]
2. **INP 不能替代连续书写延迟。** Event Timing 当前排除了 pointermove、pointerrawupdate 等连续事件；点击响应、普通页面性能指标通过，不能证明写字跟手。[^15]

## 范围与状态

本记录核对日期为 2026-09-13，应用代码仍为 `a31de69e` 对应的自然笔锋实现，基于干净工作树继续审阅。本次新增研究记录与索引，不改变应用参数、绘制实现或生产环境；阶段保持 R1-Live-2。无大屏实测，无浏览器自动验收。

此前的亚像素尾点、采样粗细、保存保真和点数合同详见 [笔迹代码复查](classroom-ink-code-review-20260913.md)。这些问题继续登记，当前优先验证持续显示拖后的输入与呈现路径。源码确认的机制、社区历史案例和现场主因保持不同证据等级。

## 来源

[^1]: Excalidraw，*Perfect Freehand Drawing #4802*。dwelle，2022-02-17，[同参数差异](https://github.com/excalidraw/excalidraw/issues/4802#issuecomment-1042933394)；kwetter，2022-10-28，[窗口大小与示例手感报告](https://github.com/excalidraw/excalidraw/issues/4802#issuecomment-1294987815)。属于当时版本的体验及维护讨论。
[^2]: W3C Pointer Events，Rick Byers，*Consider a simple API for low-latency pointer trails #204*，2017-05-05，[原始提案](https://github.com/w3c/pointerevents/issues/204)；Navid Zolghadr，2019-05-15，[工作组反馈](https://github.com/w3c/pointerevents/issues/204#issuecomment-492703660)。
[^3]: Excalidraw，dwelle，*improve the performance Ink #5192*，2022-05-14，[维护者对重绘与节流的解释](https://github.com/excalidraw/excalidraw/issues/5192#issuecomment-1126727115)。
[^4]: W3C Pointer Events，Dave Tapuska 等，*Define a low latency event that isn't occur in the document lifecycle #214*，2017～2018，[等待与硬件图层讨论](https://github.com/w3c/pointerevents/issues/214#issuecomment-319787283)、[全局高频事件的影响](https://github.com/w3c/pointerevents/issues/214#issuecomment-404001181)。历史命名 pointerrawmove 现为 pointerrawupdate。
[^5]: MDN content，Josh-Cena，*pointerrawupdate is for latency, not precision #44029*，2026-08-14，[维护讨论](https://github.com/mdn/content/issues/44029#issuecomment-5297628853)。
[^6]: WHATWG HTML，*What is Canvas desynchronized attribute? #5466*。kainino0x，2020-04-20，[平台差异](https://github.com/whatwg/html/issues/5466#issuecomment-616729287)；kenrussell，2020-04-22，[绘图用途、闪烁与 WebGL 上下文](https://github.com/whatwg/html/issues/5466#issuecomment-618048292)。
[^7]: Chromium Authors，2026-09-13 源码版本 `995b3c82e3ab8db92f978be4e49a1bd3761156f9`，[HTMLCanvasElement 上下文与提交路径](https://github.com/chromium/chromium/blob/995b3c82e3ab8db92f978be4e49a1bd3761156f9/third_party/blink/renderer/core/html/canvas/html_canvas_element.cc#L591)。
[^8]: Chromium Authors，同一固定版本，[Canvas 2D 低延迟资源的平台能力条件](https://github.com/chromium/chromium/blob/995b3c82e3ab8db92f978be4e49a1bd3761156f9/third_party/blink/renderer/platform/graphics/gpu/canvas_utils.cc#L149)。
[^9]: Chrome for Developers，Dave Tapuska，*Aligned input events*，2017-06-22，[连续输入与 RAF 对齐机制](https://developer.chrome.com/blog/aligning-input-events)。历史介绍用于解释机制，不采用其中旧硬件采样率作为现场参数。
[^10]: WICG，Ben Mathwig，*Ink API*，Draft Community Group Report，2024-09-16，[系统尾迹、可信事件和样式合同](https://wicg.github.io/ink-enhancement/)。此版本明确为社区草案。
[^11]: WICG，Daniel Libby，*Web Ink Enhancement: Delegated Ink Trail Presentation Aided By The OS*，[设计说明](https://github.com/WICG/ink-enhancement#problem)。文档已将后续更新转向规范草案；透明覆盖层及交接限制按历史设计约束引用。
[^12]: Chrome for Developers，Joe Medley，*Low-latency rendering with the desynchronized hint*，2019-05-02，[上下文首次创建、清除与透明注意事项](https://developer.chrome.com/blog/desynchronized)。
[^13]: W3C，Patrick H. Lauke，TPAC 2023，[Pointer Events Level 3 的预测尾迹介绍](https://www.w3.org/2023/Talks/TPAC/pointer-events/)。
[^14]: W3C，*Pointer Events Level 3*，Recommendation，2026-06-30，[固定版本规范](https://www.w3.org/TR/2026/REC-pointerevents3-20260630/)。
[^15]: W3C Web Performance，*Event Timing API*，审阅于 2026-09-13，[§1.4 连续事件排除规则](https://w3c.github.io/event-timing/#sec-events-exposed)。
[^16]: MDN Web Docs，*Window: requestAnimationFrame() method*，审阅于 2026-09-13，[回调 timestamp 的定义](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame#parameters)。
