# 本地开发服务内存诊断

适用于本机 `pnpm dev`。先核对监听进程、仓库路径和实际 Supabase origin，再执行已获授权的本地重启。生产操作继续走生产目标 runbook。

## 启动与限制

使用 `pnpm dev`，由 `scripts/dev.mjs` 把 `--max-old-space-size=4096` 放入 `NODE_OPTIONS`，保留其他调试、预加载参数并统一堆参数别名。锁定的 Next.js `16.2.11` 从该环境变量读取开发子进程预算；单独把堆参数放在父进程命令行会被 Next 的默认预算覆盖。在本机 Node `22.16.0` 上，实测受限子进程的 V8 总堆上限约为 4.05 GiB。

`experimental.turbopackMemoryLimit` 的 4 GiB 预算传给 Turbopack，不约束整个 Node 进程。JavaScript 堆、Turbopack 原生分配、线程和缓冲区共同形成进程占用，因此工作集仍可能高于 4 GiB。

Next 在开发请求结束时检查 JavaScript 堆使用量，超过总堆上限的 80% 时请求重启开发子进程。这个保护只覆盖该检查路径；编译期突然耗尽堆仍可能退出，需要从后台日志判断。堆限制用于降低系统内存压力，不代表持续保留对象的问题已修复。

实现依据为锁定依赖的 `dist/cli/next-dev.js`、`dist/server/lib/start-server.js` 和 `dist/server/dev/hot-reloader-turbopack.js`。正常启动保持诊断端口关闭。

## 2026-09-07 诊断结果

环境为 Windows、本机 Node `22.16.0`、Next.js `16.2.11`、Turbopack。

| 观测 | 结果 |
| --- | --- |
| 原开发进程 | 物理工作集约 14 GiB，系统物理内存占用达到 94.7% |
| 原 JavaScript 堆上限 | 约 15.95 GiB；既有 Turbopack 预算未限制此堆 |
| 首次重启后 | 工作集约 1.06 GiB；随后再次增长，回收后仍保留约 2.1 GiB JavaScript 堆 |
| 同页请求对照 | 预热后关闭诊断接口，匿名读取 `/zh/login` 30 次，全部返回 200；期间编译事件为 0，CommonJS 模块数量保持 711 |
| 对照前后完整垃圾回收 | `heapUsed` 从 632170504 增至 706963352 字节，约增加 71.3 MiB；V8 native context 从 55 增至 85 |

两份堆快照之间另有少量页面加载与开发修改，因此快照差分用于追查引用，不用于推导单次请求的增长率。差分中有新增的 React `RequestInstance`、`ResponseInstance`、异步操作记录、`WeakRef` 和 `CallSiteInfo`；引用路径包含 React 开发调试的 `pendingOperations`、懒加载对象的 `debugStack`、请求上下文和 Next 数据流/模块缓存。重复请求对照说明增长不依赖本次热更新，也不能归为首次编译缓存。

首轮确认了开发渲染对象持续保留与 JavaScript 堆预算缺失两个事实。当时只修正开发启动预算，后续复查见下节。

最终从未预设 `NODE_OPTIONS` 的后台环境运行标准 `pnpm dev`，新子进程启动 trace 的 `heapSizeLimit` 为 4.046875 GiB；健康接口和 zh/en 登录页均返回 200，诊断端口已关闭。启动器语法、定向 ESLint 与 CLI 参数检查通过。这些机器结果验证启动保护，不代表请求对象保留问题或产品人工验收已关闭。

## 2026-09-07 深夜复查与开发兼容处理

23:31 复查时，开发 worker 工作集约 4.68 GiB，系统物理内存占用 81.3%。trace 已记录四次接近堆上限的自动重启，说明预算生效，但持续保留对象仍需单独处理。

本地对照定位到两条开发调试引用链：

1. `next/dist/server/dev/debug-channel.js` 的 `reactDebugChannelsByHtmlRequestId` 保存等待 HMR 客户端连接的 HTML 调试流，当前实现缺少超时清理。匿名读取登录页 15 次后，队列从 17 增至 32，完整回收后的堆增加约 57.8 MiB。释放该缓存可以回收请求上下文。
2. 内置 React 在模块加载时启用异步调试 hook。全局 `pendingOperations` 的记录通过 `owner.props.params`、Promise 与 `kResourceStore` 反向保留请求；记录只在对应异步资源被销毁时删除，因此弱引用的 Promise 也可能被这条强引用链保留。快照分析同时检查 WeakMap 的 key 和 table 可达性，避免把条件边误报为强引用。释放 7,967 条历史追踪记录后，完整回收的堆从 944198824 降至 736852232 字节，约回收 197.7 MiB。

读取 React 调试 Error 的 `stack`、解除已结束 Immediate 的队列链接，均未明显降低保留量，因此没有采用这些处理。

开发端现在使用以下兼容处理：

- `experimental.reactDebugChannel: false` 让 React 调试信息随 RSC 响应传递，消除独立调试流等待连接的积压。
- `scripts/dev.mjs` 仅向 Next 开发 worker 的启动参数追加 `scripts/dev-react-memory.cjs`，保留既有预加载参数和堆预算。
- 预加载模块限定于 `NODE_ENV=development`、Next 开发 worker、Next `16.2.11`，并同时匹配内置 React hook 的 init/before/destroy 函数特征。它让这一项异步调试 hook 保持未启用，其他 hook、AsyncLocalStorage 和普通 Error 堆栈继续工作。构建与生产启动不经过该处理。
- 代价是减少 React DevTools 的异步等待与耗时追踪信息。需要完整追踪时，设置 `MATHIN_DEV_REACT_ASYNC_DEBUG=1` 后重新运行 `pnpm dev`。这会恢复对应追踪，也会重新暴露其内存保留行为。

对照结果：

| 配置与输入 | 完整回收后的结果 |
| --- | --- |
| 仅关闭独立调试通道，预热后请求登录页 45 次 | 等待调试流保持 0、native context 保持 6；堆仍增加约 42.1 MiB |
| 同时应用异步调试兼容处理，排除首轮热更新后的 45 次请求 | 堆增加约 5.1 MiB；两张调试表均保持 0，模块数和 native context 稳定 |
| 关闭 Inspector 后另做 60 次登录页请求，全部 200 | 堆从 536915016 增至 546581440 字节，约增加 9.2 MiB；模块数保持 676，native context 从 14 降至 13 |

首轮请求批次夹杂实际开发修改和重新编译，未用于推导修复后的请求增长率。上述短期结果说明已定位的调试积压消除、增长明显收敛；剩余少量增长和长期热更新表现仍需实际开发使用验证，4 GiB 堆保护继续保留。

定向回归 `tests/dev-memory-guard.test.ts` 加载真实锁定的 React 运行时，验证命中目标 hook、并发 AsyncLocalStorage 隔离、其他 hook 正常工作、普通错误堆栈保留，以及生产/非开发 worker/完整调试开关下不安装处理。健康接口和 zh/en 登录页均返回 200。这些是机器检查与开发端交付，不代表产品人工验收或正式 Gate 关闭。

升级 Next 时复核此处理：版本变化后预加载模块会跳过安装，而真实运行时回归会要求重新检查。先在原生新版本重复同页请求与热更新对照，确认引用保留问题消除，再移除兼容处理。

上游 [Next.js #95899](https://github.com/vercel/next.js/issues/95899) 报告过相似的异步调试增长，并描述关闭该 hook 的对照；该问题由机器人因复现链接无效关闭，不能据此认定已有官方修复。本节结论以本地源码、引用链与回收对照为依据。

## 后续复核

1. 用 `Get-NetTCPConnection -LocalPort 3130 -State Listen` 找到进程，核对其完整启动路径；同时记录系统可用物理内存、工作集和 private bytes。private bytes 不等于物理内存占用。
2. 优先读取 `.next/dev/trace` 中当前运行的 `start-dev-server` 与 `memory-usage` 事件。启动事件包含 `memory.heapSizeLimit`，请求事件包含 RSS、heapUsed 和 heapTotal；按当前运行筛选，复用已有数据。
3. 需要区分缓存与保留对象时，临时使用仅监听回环地址的 Node Inspector。记录预热后、完整回收后的基线，再对同一页面做有限请求；同时记录编译事件和模块数量，排除其他开发任务引入的变化。
4. 堆较小时才采集快照。原始 trace 和快照可能含请求数据、配置或凭据，放系统临时目录或受控存储，汇报仅保留脱敏数字与引用路径；分析完成后删除本次快照并关闭诊断接口。
5. 对将来的修复候选复用相同请求对照，再观察实际热更新工作流；机器检查通过后继续交付开发页面人工验收。

诊断方法参考 [Next.js 官方内存指南](https://nextjs.org/docs/app/guides/memory-usage)。本次未进行生产部署或生产写入。
