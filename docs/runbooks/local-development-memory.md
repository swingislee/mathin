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

目前确认了开发渲染对象持续保留与 JavaScript 堆预算缺失两个事实。快照尚不足以把全部增长归因到一个可安全修改的上游函数；本次只修正开发启动预算，保留源码映射与业务行为。

最终从未预设 `NODE_OPTIONS` 的后台环境运行标准 `pnpm dev`，新子进程启动 trace 的 `heapSizeLimit` 为 4.046875 GiB；健康接口和 zh/en 登录页均返回 200，诊断端口已关闭。启动器语法、定向 ESLint 与 CLI 参数检查通过。这些机器结果验证启动保护，不代表请求对象保留问题或产品人工验收已关闭。

## 后续复核

1. 用 `Get-NetTCPConnection -LocalPort 3130 -State Listen` 找到进程，核对其完整启动路径；同时记录系统可用物理内存、工作集和 private bytes。private bytes 不等于物理内存占用。
2. 优先读取 `.next/dev/trace` 中当前运行的 `start-dev-server` 与 `memory-usage` 事件。启动事件包含 `memory.heapSizeLimit`，请求事件包含 RSS、heapUsed 和 heapTotal；按当前运行筛选，复用已有数据。
3. 需要区分缓存与保留对象时，临时使用仅监听回环地址的 Node Inspector。记录预热后、完整回收后的基线，再对同一页面做有限请求；同时记录编译事件和模块数量，排除其他开发任务引入的变化。
4. 堆较小时才采集快照。原始 trace 和快照可能含请求数据、配置或凭据，放系统临时目录或受控存储，汇报仅保留脱敏数字与引用路径；分析完成后删除本次快照并关闭诊断接口。
5. 对将来的修复候选复用相同请求对照，再观察实际热更新工作流；机器检查通过后继续交付开发页面人工验收。

诊断方法参考 [Next.js 官方内存指南](https://nextjs.org/docs/app/guides/memory-usage)。本次未进行生产部署或生产写入。
