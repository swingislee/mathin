# 班级与课堂入口加载优化 · 2026-09-08

状态：开发端已交付，待人工视觉与交互验收。本次是 R1-Live-2 下的开发增量，生产应用尚未发布，Gate 状态保持原值。

## 定位与实现

- 班级详情原先在显示班级身份和课堂入口前等待全量个人工作项、教室选项、员工选项、接下来课次的教学准备与公开课来源。核心信息先返回，工作项列表、风险、设置和公开课来源分别流式加载。风险仍使用原来的真实查询，设置仍取得完整准备数据；设置页、准备页和课次管理按需等齐相关数据。
- 班级顶部及课次列表的“进入教室”改为直接访问 `/classroom/[classId]/session/[sessionId]/live`。原地址会经兼容路由进入课次备课工作区。课堂原有授权、冻结与开课操作继续生效。
- 原课堂预载先等待旧媒体、依次解析所有 H5 包，再扫描全部对象缓存并批签，期间已启动多个包的完整 HTTP 预热。`fetch` 只等到响应头，使按请求计数的并发限制不能约束实际正文下载。
- 页束就绪后，当前页对象、旧媒体和 H5 入口独立加载。缓存命中直接产生可用 URL，首次缺失才触发本课共享的一次批签；H5 入口取得后立即发布。队列在空闲槽处跟随当前页优先级。
- 完整 H5 包预热在上述读取之后进行，所有包共用两个正文下载槽，正文消费完成才释放槽。非 H5 对象继续写入离线缓存，H5 继续采用在线提示；离开课次后取消请求并释放本轮 objectURL。
- 预载生命周期集中在 `useSessionAssetPreload`。输入配置仍按原四个依赖 memoize，独立 hook 保留原有输入行为并通过 React 编译检查。

## 实际样本与计时边界

固定开发教师的一个既有课次只读样本：34 页，页束 JSON 452,784 字节；177 条绑定，57 个独立非 H5 对象；5 个 H5 包、216 个文件，manifest 合计 56,125,577 字节。样本用于确认资源规模，不代表每个课次或生产分布。

本机目标按 `scripts/lib/history-local-target.mjs` 完成主机、Supabase origin、监听进程、Docker 网络及数据库标识核对。使用既有固定教师账号，只读读取班级、课次、页束和 manifest；未创建测试身份或修改课次业务数据。生产仅进行了服务与版本只读核查，没有迁移、服务重启或发布。

开发 HTTP 检查中，热更新并发期间曾出现 10–13 秒响应，同期其他页面也持续编译并出现长响应。停止本任务代码修改后的复核：班级详情 918 ms、课堂入口 915 ms，均为 HTTP 200，未检出服务端渲染错误。较早暖请求分别为 332 ms、296 ms，因此这些不同负载下的样本不能用于宣称速度提升比例。HTTP 检查未执行浏览器端课件资源加载，实际首屏与点击手感等待人工验收。

## 定向机器检查

| 检查 | 结果与覆盖 |
| --- | --- |
| `vitest run tests/classroom-entry-preload.test.ts tests/p6-classroom-doc.test.ts tests/p6-session-asset-action.test.ts tests/r1-classroom-continuity.test.ts` | 4 文件、39 项通过；覆盖当前页先可用、H5 入口增量发布、缓存与批签、切页优先级、离线与取消、正文全局并发上限和既有课件合同 |
| `vitest run tests/p4i-13-classroom-workspace.test.ts tests/classroom-reactivation-and-prep-access.test.ts tests/classroom-setup-workspace.test.ts` | 3 文件、12 项通过；课堂入口、班级设置与准备能力合同 |
| `vitest run tests/classroom-entry-page.test.ts` | 1 项通过；辅助查询持续未完成时，核心班级内容与直接课堂链接仍可返回 |
| hook 抽取后的 `vitest run tests/r1-classroom-continuity.test.ts tests/classroom-input-router.test.ts` | 2 文件、27 项通过；预载接线与课堂输入合同 |
| 本次修改文件 ESLint | 通过；React 编译检查通过，保留手动 memoization |
| 应用源码及新增测试 TypeScript 定向配置 | 通过；包括生成的 Next 路由类型 |
| 班级与课堂 HTTP 只读复核 | 两条路由均 200，未检出服务端渲染错误；不作为浏览器性能验收 |

机器检查证明上述加载顺序与合同，产品负责人继续在开发端检查打开班级、进入教室及连续翻页的实际体验。
