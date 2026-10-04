# 大屏试讲触摸问题 · 2026-09-12 只读诊断

状态：生产只读核查完成；尺规和形状的触摸保护及捕获处理已在开发端修复，待实际大屏人工验收。默认掌擦模式差异已由源码确认，实际设备的触摸取消原因与输入延迟尚待采样。本轮没有生产应用发布、服务重启、数据库或 Storage 写入，不改变 R1-Live-2 和 Gate 状态。

## 现场与生产事实

用户反馈画笔和掌擦不跟手、形状无法移动、尺规操作返回，并确认大屏直接打开 `mathin.club`，不经投屏。检查时间为北京时间 2026-09-12 09:55～09:58，数据库统计窗口自当天 08:00 起。

| 核查项 | 实际结果 |
| --- | --- |
| 执行目标 | SSH 主机 `xiaomi`；应用运行进程的 Supabase origin 为 `https://supabase.mathin.club`，站点为 `https://mathin.club` |
| 运行版本 | current 和进程工作目录均为 `20260911-153257`，对应已登记候选 `aed8fec48ddb15e24049e6afa01b197d432674ba` |
| 服务 | `mathin.service` active/running，NRestarts=0；应用监听 `127.0.0.1:3131`，health 返回 ok/production |
| 服务器资源快照 | load average 0.44 / 0.63 / 0.67；可用内存 4,361 MiB。该快照没有显示服务器资源拥塞，不能代替大屏性能测量 |
| 错误 | 应用 journal 的 error 级记录自 08:00 起为 0；`operational_errors` 总数 2,017，最后记录为 2026-09-09 17:10:56 北京时间，本次窗口新增 0 |
| 正式事件 | 截至 09:55，窗口内有 28 条 page、2 条 session_ctl。指定教师匹配 1 个身份，在该窗口的正式 session_events 为 0 |
| 板书持久化 | 截至 09:58，窗口内旧 board/board_snapshot 事件和 v2 checkpoint 均为 0；这不表示老师没有操作 |

数据库使用 `BEGIN READ ONLY`、5 秒 statement timeout 和 `ROLLBACK`，已确认 `transaction_read_only=on`。仅输出聚合数量和时间，不登记身份 ID、课件正文或笔迹内容。

本地 whiteboard、classroom/input、useClassBoard、useClassroomViewportGestures 与 eventlog 源码和上述生产候选逐文件比较无差异。生产版本依据现有发布记录及当前 release 路径核对；没有重新对生产 bundle 做内容审计。

## 已确认的代码行为

1. **试讲数据可见范围**：`SessionEventLog` 的 ephemeral 模式使用内存事件与隔离实时频道，不写正式 outbox/数据库。绘制中的 fx 本身也是短命消息。因此服务器查库不能还原这次试讲的笔迹、触点面积、pointercancel 或落笔耗时。当前也没有这类前端性能上报。
2. **形状操作入口**：`BoardObjectLayer` 仅在箭头工具或 Smart 画笔下允许变换，形状绘制工具不会直接变成拖动工具。箭头模式需要保留稳定的触摸操作边界。
3. **尺规回弹路径**：`trackInstrumentPointer` 将 pointercancel、lostpointercapture 等交给取消分支；`InstrumentLayer` 取消时恢复起始尺规对象。普通课堂箭头模式的舞台未持续设置 `touch-action:none`，尺规根 SVG 与形状层也未统一设置。专注模式会由视图手势 hook 设置舞台 touch-action。浏览器接管滚动导致取消是优先验证的假设，尚未取得现场事件证明。
4. **掌擦模式差异**：工具栏 `lastEraser` 仅存在组件本地状态，默认值为 strokeEraser；掌擦输入端口只传 eraserWidth，CanvasSurface 固定生成局部 erase 笔迹，不能读取默认整线/局部橡皮选择。
5. **延迟相关实现**：画笔按 requestAnimationFrame 合批，采用 perfect-freehand 的 smoothing/streamline；掌擦识别后等下一次 move 才开始，游标通过 React 状态刷新，擦除逐点计算路径。这些是应测量的热点，不能据此给出实际延迟毫秒数。50ms 远端笔迹广播间隔不等于大屏本地落笔延迟。

## 下一步优化顺序与验收

| 顺序 | 工作 | 最窄验证 |
| --- | --- | --- |
| 1 | 统一形状与尺规触摸边界、指针捕获和结束处理；显式取消仍按既有合同收尾 | 大屏普通/专注模式各拖动、旋转、缩放并松手；确认最终位置保留，再覆盖第二触点和真实 pointercancel |
| 2 | 将默认橡皮模式放入共享工具状态，掌擦读取同一选择；整线擦与局部擦分别保留撤销和同步 | 切换整线/局部橡皮后回画笔，用掌擦验证同一语义、撤销、取消恢复及主副板书一致 |
| 3 | 采集输入分发等待、帧间隔/长任务、绘制耗时、触点面积与取消原因，再减少首帧等待、游标重渲染和重复路径计算 | 同一大屏、页面、笔迹负载前后对照；p50/p95 时间和取消次数配合老师实际手感验收 |

课前可先用箭头工具拖动现有形状与尺规，并在“专注课件”模式重复同一操作，以验证触摸边界假设。临时操作建议尚未由现场验收；正在试讲时保持当前页面，刷新会丢失仅在内存中的试讲状态。

## 定向检查

`node node_modules/vitest/vitest.mjs run tests/whiteboard-smart-input.test.ts tests/whiteboard-palm-input.test.ts`：2 个文件、19 项通过，耗时 1.86 秒。覆盖现有尺规取消后复位、释放监听与掌擦固定局部擦除合同，不代表当前产品问题已解决或大屏体验已通过。未运行浏览器替代人工验收，也未运行全量 Gate。

## 现场补充与开发修复

用户进一步明确：尺规点击有反应，拖动时轻微变化然后立刻恢复，像“晃了一下”，不是松手后才返回。该现象提高了拖动中途取消的排查优先级；现场的具体事件序列仍未采集。

开发端修复如下：

- 尺规与形状根 SVG 预先声明 `touch-action:none`，普通课堂也能在对象区域保持自定义拖动。修改限于白板对象层。
- 尺规的 lostpointercapture 监听只处理捕获所有者自身发出的事件。子元素的释放事件冒泡到手柄时保持当前拖动；真实 pointercancel、所有者失去捕获和页面生命周期中断继续取消。事件会冒泡且目标是原捕获节点，依据 [Pointer Events 规范](https://www.w3.org/TR/pointerevents3/#the-lostpointercapture-event)；这证明代码应区分事件来源，不能代替现场原因确认。
- 形状复用现有指针跟踪器，以窗口捕获监听接收移动/松手，采用松手坐标提交并释放监听，取消与卸载不提交。轻点不产生重复编辑或撤销条目。

三条新增故障复现先在旧实现失败，修复后通过：子节点捕获释放导致尺规复位、形状缺少捕获、形状卸载后残留监听仍提交。补充轻点只选中回归后，whiteboard-smart-input 的 20 项通过；另外复用本轮已通过的 viewport gestures、input router、geometry 和 client UUID 四组结果，共覆盖 5 个文件、44 项。改动文件 ESLint 通过。

全库 `tsc --noEmit` 未通过：`tests/teacher-workspace-entry.test.ts:31` 的 `page` 可能为 undefined（TS18048）；该文件与 HEAD 一致，位于本次白板变更之外，未修改。未将定向通过登记为全库通过。

复用本机既有开发进程，确认开发 Supabase origin 为 `http://127.0.0.1:35421`，Next 监听 3130；本机和局域网 health 均为 200/development，班级页面匿名请求按预期 307 到登录。验收入口：`http://192.168.5.213:3130/zh/dashboard/classes`。登录开发账号，在课堂普通/专注模式分别验证尺规平移、旋转、拉伸和形状移动/撤销。本轮未以浏览器自动化替代实际触摸验收，掌擦模式与落笔延迟优化仍为后续增量。
