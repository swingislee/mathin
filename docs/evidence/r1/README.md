# Mathin R1 发布证据索引

- [正式统计排除测试身份与员工别称归一（2026-09-21）](production-statistics-identity-scope-20260921.md)：已部署，待用户验收。

- [2026-09-21 HAR 热点与底层读取深度优化](dashboard-deep-reads-20260921.md)：任务先选页再补字段、素材窄索引与本页明细、学生分组按需且一次聚合；课件读取并行。真实 HTTP 课件约 1.53–2.24 秒降至 34–111 毫秒、素材约 2.44–5.19 秒降至 0.60–1.27 秒，学生仍约 1.0–1.4 秒；74 组等价对照与回滚通过，开发已应用。保留一次未归因的名录超时及后续读取边界，未发布生产、未验收整页 1 秒。

- [2026-09-21 数据库优化后本地逐路由 HAR](dashboard-local-route-har-20260921.md)：23 个路由与同轮开发日志对照；线索/沟通/测评主响应约 0.50/0.49/0.27 秒。区分课程页框架等待与课件任务、素材库、学生名录的应用热点，补记主响应后的重复待办读取；作为后续优化参考，未验收整页 1 秒或生产性能。

- [2026-09-21 总览统计内核首批](overview-aggregate-core-20260921.md)：沟通/获客改由数据库生成计数、趋势和人员汇总，约 8.3 KB；真实 HTTP 继续定位教师逐行协作权限开销，复用批量可见集合。两条迁移已应用开发库，统计、真实保存、权限集合与回滚检查通过；页面接入、生产切换和 1 秒目标验收待后续批次。

- [2026-09-21 获客 SQL 的重复权限与原文解析开销](overview-acquisition-projection-20260921.md)：定位逐行管理员检查、两遍档案读取及每次重拆 JSON；改为同步生成字段、单次扫描和查询内权限复用。本机完整 RPC SQL 首次 127 ms、随后 74–75 ms，生产 3861 条只读等价；开发已应用，生产未部署。

- [2026-09-21 大屏单次快照与导航预取诊断](overview-critical-path-20260921.md)：获客四页合为一次有界快照，生产只读等价对照约 1.37 → 0.68–0.73 秒；侧栏按悬停/聚焦预取。本机生产构建冷启动数据可见 1.58 秒、硬刷新 0.91 秒、侧栏切换 0.92 秒；仍有约 8.85 MB 内部事实读取，开发可验收，生产未部署。

- [2026-09-21 大屏实际 HAR 与获客别名读取诊断](overview-first-load-har-20260921.md)：用户大屏 RSC 响应 5.26 秒；定位新增来源 RPC 逐条重扫历史版本，四页生产只读等价对照 3.01 → 1.37 秒。窗口聚合修复及执行计划回归检查已应用开发，生产未发布，完整首屏仍待复测。

- [2026-09-21 获客总览增量来源修复](overview-acquisition-incremental-production-20260921.md)：移除固定旧文件筛选，按稳定 Base 行合并增量版本，保留旧关联并校验分页版本；生产 9 月获客由 93 更新为 312。备份、回滚演练、来源集合及发布后检查通过，已部署待人工验收。

- [2026-09-21 表格数据库分页与当前页补齐](table-database-pages-20260921.md)：测评每页从 110 次全量读取改为一次数据库分页 RPC，详情按展开主体读取；沟通首联先分页再补字段；修复线索关联读取的 REST 截断。权限、字段／分页等价及局域网页面检查通过，开发可验收，未发布生产。

- [2026-09-20 课堂 Smart 连接恢复](classroom-smart-connection-development-20260920.md)：复现并修复翻页清空新连接、超时不重连两个灰色开关原因；定向检查通过，开发端待用户验证，生产未部署。

- [2026-09-20 表格加载优化复核](table-loading-review-20260920.md)：重新核对生产版本与策略，确认最近几轮尚未发布、旧优化仍保留；测评每页及空搜索仍全量读取 930 条、110 次请求，沟通其他标签与工作单仍有重计算。修复静态审计别名漏报的 20 个调用点；记录 REST 上限风险与后续统一读取边界，未发布生产。

- [2026-09-20 沟通与测评首屏读取优化](communication-assessment-loading-20260920.md)：清理沟通旧工作批次入口，批量计算可见范围并省去内嵌首联未使用的查询；测评全量筛选后只传当前页。本机生产构建禁用缓存后沟通名单可见约 1.07–1.86 秒、测评约 1.08–1.12 秒；权限、结果等价与回退通过，开发已应用，生产未部署。

- [2026-09-20 Dashboard 其他页面加载逻辑复查](dashboard-related-read-paths-20260920.md)：覆盖 75 个入口；学生、课程意向等 11 条 SELECT 策略按查询求值，分班／续班／测评改善串行读取及分页完整性。开发真实 RLS 对照与回退通过，已应用开发库，生产未部署；线索全量补齐后分页及部分范围查询列为后续重点。

- [2026-09-20 总览与线索读取的权限前置判断](dashboard-lead-read-guards-20260920.md)：三个 SELECT 策略先判断账号必要权限；开发真实 RLS 无权限员工的四类读取约 2.1 秒降至 1.5–2.7 毫秒，75 组范围对照、60 组策略回退与事务零残留通过。已应用开发数据库，生产尚未部署。

- [2026-09-20 大屏刷新与侧栏切换实测](dashboard-browser-first-load-20260920.md)：固定账号在生产实际为受限 staff；硬刷新 8.75–8.78 秒、普通刷新 8.77–8.89 秒、侧栏切换 7.86–8.51 秒。定位线索 RLS 返回空结果仍逐行判断 3942 条记录；只读权限前置模拟约 6.84 秒降至 5.7 毫秒。后续开发修复见上项，正式管理员生产时间待测。

- [2026-09-20 Storage 首次响应异常审查](storage-first-request-audit-20260920.md)：2.8 秒为运维 HEAD 异常，实际接口不读取图片文件，七天浏览器签名资源源站响应最长约 454 毫秒；精确阻塞点未知。确认服务端签名绕公网的额外等待，局部传输补丁通过定向检查，尚未部署。

- [2026-09-20 白板自定义颜色](whiteboard-custom-colors-development-20260920.md)：常用色之外增加取色器与 HEX 输入，贯通笔迹、图形、同步、快照和导出；本地校验迁移通过并应用，开发端待人工验收，生产未部署。

- [2026-09-20 Dashboard 查询优化生产发布与资源首屏检查](dashboard-query-production-20260920.md)：独立候选 `1eaab0fb` 与三条迁移已上线，备份、权限等价、回滚和发布后检查通过，保留原 428 个 Action 标识。资源 RPC 约 0.52–0.66 秒；Storage 首次 HEAD 2.8 秒慢样本未在复测重现，登录后完整首屏仍待测量。

- [2026-09-20 画笔极细档与线宽滑块](classroom-pen-width-development-20260920.md)：原粗细菜单新增极细预设、自由微调、数值与线宽预览，复用主副板书工具态同步；类型、双语及相关检查通过，开发端待教师书写验收，生产未部署。

- [2026-09-19 Dashboard Supabase 查询核查与优化](dashboard-query-audit-20260919.md)：覆盖 70 个页面、3 个读取路由与共享布局，改善请求内重复读取、批次等待、学生学习串行、课件统计截断、资源聚合与课堂事件权限查询。44 项定向测试、数据等价与权限回滚通过；已于 9 月 20 日移植为独立候选发布生产，页面体验待验收。

- [2026-09-15 课评保存与发布失败诊断](session-review-deployment-skew-20260915.md)：性能发布后的 33 次旧接口请求均映射到课评保存，已确认会阻止旧编辑页自动保存和逐生发布。目标课次截图可见文字已落库，10 条课评于 16:29:31 发布；跨版本草稿保护仍待修复。

- [2026-09-15 大屏首次加载与学科运营响应](dashboard-cold-start-20260915.md)：`2ded3c75` 已单独发布生产，包含前轮传输补丁、路由加载、静态消息、统计并行和同机网关配置。构建、备份回退及机器 postflight 通过；本机 Linux 首次大屏为 1.43–1.49 秒，生产可操作时间待人工验收，已打开的旧页面需刷新。

- [2026-09-15 大屏与学科运营服务端传输优化](dashboard-server-transport-20260915.md)：候选 `ec60f97a` 已纳入后续 `2ded3c75`，服务端可走已核对的同机 Supabase 网关，并减少测评逐批等待；930 条记录与顺序等价、双语和权限闸门、候选构建通过。保留本轮首次大屏 3.44 秒的历史测量，当前发布状态见上方深度修复记录。

- [2026-09-15 教学标题栏生产对齐](teaching-header-production-fix-20260915.md)：正式页与本地复现共用分组和时间标题栏，默认上周，待办与完成情况收进右侧“⋯”。独立候选 `f019ce9d` 已部署，账本 392 和业务数据保持一致，待人工验收。

- [2026-09-15 教学工作台生产发布](teaching-production-release-20260915.md)：独立候选 `8bd17893` 与 5 条迁移已部署，实时紧凑学情、原位详情、年级／老师分组、周／月／学期及作业逐题登记上线；备份、回退演练、40 组生产读数和发布后检查通过，待用户实际验收。

- [2026-09-15 教学周／月／学期查看](teaching-period-development-20260915.md)：总览式时间控件、当前／上一期快捷入口、真实学期日期与带时间范围的详情读取；标题栏简化为分组与时间。按用户明确的项目启用日，只读更新 9 月 7 日至采集时刻的三位老师记录，启用前范围单独提示；本地检查通过，页面待人工验收。

- [2026-09-15 纸质作业逐题登记](homework-question-entry-development-20260915.md)：沿用课堂六档学情，按学生或按题登记，批量填充、备注、撤销及教学详情矩阵；本地数据库、权限、版本冲突和持久再读检查通过。已随教学工作台发布，待实际验收；学生在线逐题入口待后续接入。

- [2026-09-15 三位老师上周教学记录与分组](teaching-production-replay-20260915.md)：加入薛立志，快照包含 12 班、12 课次、226 条学情；支持按档案年级或实际任课老师分组，组内原位展开。后续标题栏调整见上方时间维度记录。开发端可验收，生产只读提取，未写入或部署。

- [2026-09-15 学生与学服读取深度修复](student-list-deep-read-20260915.md)：批量协作读取、再联系数据库分页、同组及未分配超时修复，报名／续报省去未使用的来源传输。独立候选 `58ebc8b4` 已单独部署生产，账本 387；写前备份、逻辑回滚、数据与权限对照、43 项运行检查及 16 个聚合读取复测通过，待人工体验验收。

- [2026-09-15 Dashboard 逐路由核查](dashboard-route-audit-20260915.md)：82 页面、2 读取接口及 29 个主要查询状态逐项记录，生产 168 项双语匿名保护通过；开发同组再联系仍报 VALIDATION，慢请求、暂态失败与动态样本边界分别保留，待生产体验验收。

- [2026-09-15 Base、开发库与生产库独立核查及增量](base-triangulation-production-20260915.md)：已写入生产并复读通过；新增学生 1、成员 4、待核线索 1、诺访登记 2，沿用现有推定与备注字段标注身份、班级、日期及疑似测试资料问题。正式在读 163、9 月诺访 62；旧报名保留当前，新来源重复投影转历史。开发个人明细未上传，待一线业务核对。

- [2026-09-14～15 学生再联系读取性能](student-recontact-read-performance-20260914.md)：独立候选 `1ad14a81` 已获单独授权并部署，账本 385；生产未接通约 11.43 → 1.46 秒、沉默约 15.93 → 4.80 秒，备份、完整对照、回滚及 postflight 通过。同组既有参数拒绝单独记录为剩余问题。

- [2026-09-14 学生与学服子路由性能](school-route-performance-20260914.md)：第二条补丁发布至账本 384，生产管理员当前线索约 1.63 秒降至 95 毫秒，18 项完整读取与发布检查通过；后续第三条亦已单独部署，最新路由核查与剩余差异另页记录。

- [2026-09-14 Base 大屏与生产总览复核](base-dashboard-reconciliation-20260914.md)：保留当时获客、诺访及在读差异基线；9 月 15 日已完成成员、诺访和问题标注增量，见上方三方核查记录。获客旧文件入口与日期格式兼容仍待应用读取修复。

- [2026-09-14 管理员总览加载回退修复](dashboard-collaboration-read-regression-20260914.md)：已部署生产，账本 383；11 类生产权限上下文的 18 项读取对照及回滚检查通过，管理员沟通首批查询约 2.36 秒降至 75 毫秒，应用未重启，待人工体验验收。

- [2026-09-14 Base 用户运营资料生产增量](base-incremental-production-20260914.md)：与生产原档比较后保存 46 行新增、189 行变更及相关业务增量；备份、完整回滚演练、持久再读和应用 RPC 核对通过。班级、学生身份和人工修订保留，1 条同名资料待核对；待人工业务验收。

- [2026-09-14 0.1.4 生产发布](version-0.1.4-production-20260914.md)：课堂书写、掌擦、触摸拖动、教学工作台、学生协作与历史线索接续已上线；六条迁移经过写前备份、完整回滚零残留和正式提交，应用及 Worker 原子切换与 postflight 通过。原有业务与资源保持，待实际设备和业务人工验收。

- [2026-09-13 PF 时间压力与轮廓优化](classroom-timed-ink-development-20260913.md)：freehand-v3 按时间估算模拟压力、平滑真实压力、用二次曲线连接轮廓，处理短笔画压力与停顿鼓包；活动压力缓存、版本化同步和保存保持一致。附实际渲染路径对照与 581 帧复算；开发端待人工书写验收，生产未部署。

- [2026-09-13 鼠标书写粗细起伏复刻](classroom-mouse-ink-reproduction-20260913.md)：以当前输入筛选和 PF 复算六类合成轨迹，隔离采样间隔、减速、微摆、坐标取整、参数与曲线连接的影响；确认保留点列时改变时间不改变当前轮廓，RAF 合批不改变最终点列。附复用脚本与可回放对照；仅分析实验，应用参数保持原样。

- [2026-09-13 PF 跟随与压力开发增量](classroom-pf-pressure-development-20260913.md)：活动层局部清除与轮廓缓存、手势边界复用和当前帧小尾点预览；Canvas／Smart／H5 保留压力与时间，freehand-v2 使用 PF 压感并兼容模拟粗细，配套保存、进度、归档与重放。开发端待低端 Windows 大屏验收，生产未部署；自研钢笔记录为未来候选。

- [2026-09-13 中文书写与签字栏笔迹方案选型研究](classroom-ink-engine-landscape-20260913.md)：以 PPT 绘图钢笔／铅笔及签字栏手感为参照，比较签名库、轨迹模型、专业 SDK、原生框架和封装层；核对固定源码、版本与社区反馈，复算 smooth-signature 的短点和末端行为。建议先对照 signature_pad、smooth-signature 风格、Atrament 与现有 PF，完整引擎作为后续候选；仅研究记录，应用和生产保持原样，实际书写待人工验收。

- [2026-09-13 笔迹持续显示拖后的代码与社区研究](classroom-ink-display-latency-research-20260913.md)：结合 Excalidraw、Pointer Events、WHATWG 讨论及固定版本 Chromium 源码，定位普通 Canvas 与低延迟输入/提交路径的差异，记录 Windows 资源条件、透明画布交接和预测尾迹方案。优先验证输入到呈现的时间链路，保留自然笔锋；本次仅研究记录，实际大屏主因待测。

- [2026-09-13 笔迹代码复查与同类实现对照](classroom-ink-code-review-20260913.md)：对照 Excalidraw/tldraw，复现最新点滞留、采样密度影响粗细、保存抽点改变笔锋及单笔点数合同不一致；附只读复算脚本。按用户补充，将可见笔迹持续落后于实际落点设为首要排查主线，区分输入、应用绘制与实际显示，其余问题分别跟踪。应用保持原样，实际大屏延迟主因仍待测定。

- [2026-09-13 自然笔锋与跟随优化](classroom-natural-ink-development-20260913.md)：按用户体验恢复 perfect-freehand 模拟粗细，降低轨迹平滑并对齐笔尖；活动笔画整体更新，预览与收笔同一轮廓规则。定向检查通过，待大屏验收书写美观与跟手感，生产未部署。

- [2026-09-13 课堂笔迹跟随与掌擦开发增量](classroom-ink-optimization-development-20260913.md)：课堂起笔即显色、等宽圆头跟随、连续提交补画及版本化回放；掌擦立即响应并跟随默认橡皮，整笔擦支持一次撤销。定向检查通过，开发端可验收，全库类型检查仍有既有范围外测试报错，生产未部署。

- [2026-09-12 大屏笔迹专项分析](classroom-ink-latency-analysis-20260912.md)：根据“每笔拖后、慢写较好”聚焦起笔、平滑、模拟压力及掌擦；补充复现预览与收笔轮廓差异、输入重复几何读取、同批提交漏画边界。生产开关核对为直接画布输入，实际大屏延迟待测量，应用未修改。

- [2026-09-12 正式课堂留存分析](classroom-formal-session-analysis-20260912.md)：17 份板书最终快照、849 条笔迹结构一致；今日 79 条事件序号连续，学情 4×8 条覆盖完整。按老师到下课时间未点击“下课”的补充，撤回结束事件缺少即为保存故障的判断；点名为空与课后读取超时保留为独立观察。只读核查，生产未改动。

- [2026-09-12 大屏试讲触摸诊断与开发修复](classroom-touch-diagnosis-20260912.md)：生产服务和错误核查正常；尺规与形状触摸保护、捕获来源判断及拖动收尾已在开发端修复，定向检查通过，全库类型检查仍有范围外测试报错。待实际大屏验收，生产未发布；掌擦模式与延迟采样待后续处理。

- [2026-09-11 课堂学情页边提醒生产发布](classroom-learning-reminder-production-20260911.md)：实际课堂增加站点玫瑰红细框与书签，并修复试讲空配置引起的全页误提醒；`aed8fec4` 已完成原子生产切换与 postflight，待任课教师人工课堂验收。


- [2026-09-11 教学工作台开发交付](teaching-workbench-development-20260911.md)：教学待办独立承载，主管按老师和课次查看备课、课后产出及联络状态，铃铛仅统计未读通知。定向状态、权限及双语 HTTP 检查通过，开发端待人工验收。

- [2026-09-11 Base 学员资料核对生产发布](base-review-production-20260911.md)：生产现有 5,338 条 Base 来源、92,810 个字段的三个整理版本及四条推定活动关联已上线；备份、整批回滚零残留、真实角色权限和提交后逐条再读通过，既有业务保留，待人工验收。

- [2026-09-11 多人活动安排推定关联](base-activity-source-links-development-20260911.md)：剩余一条多人安排拆为四段，各自匹配现有线索档案，沿用“资料关联待核对”标签。开发检查通过，同日按生产对象重建并发布，待人工核对。

- [2026-09-11 Base 待确认第三轮整理](base-review-resolution-development-20260911.md)：按确认规则完成错填归位和同格拆分，345 项待确认降至 1 项；159 个字段标为“资料待补”，5 组家庭来源保存 10 份子女资料。开发检查通过，同日随 Base 核对批次发布生产，待人工验收。

- [2026-09-11 课堂全屏与交互生产发布](classroom-focus-production-20260911.md)：全屏专注、缩放和位置同步、贴边视图工具、独立学生浮窗、Smart 与手掌擦除、尺规拖动修复已上线；应用构建与生产只读检查通过，待实际课堂与触摸屏验收。

- [2026-09-11 首页与列表读取优化生产发布](read-performance-production-20260911.md)：首页两轮、当前学生与线索、全量档案及课件素材库全部上线；写前备份、迁移回滚零残留、生产读取与运行检查通过，待人工使用验收。

- [2026-09-10 课件素材列表读取提速](courseware-asset-list-performance-20260910.md)：批量汇总引用、当前页读取明细并按筛选选择计划；素材库预热后完整页面约 5.7 → 1.5～2.0 秒。完整目录、筛选分页、权限与回滚对照通过，已于 2026-09-11 发布生产，待人工使用验收。

- [2026-09-10 学生档案分页读取提速](student-list-page-work-performance-20260910.md)：筛选排序缩小传递字段，操作标记只为当前页计算；全量待测评完整页面管理员约 4.8 → 2.5 秒、教师约 7.8 → 4.1 秒。完整数据、权限和回滚对照通过，已于 2026-09-11 发布生产，待人工使用验收。

- [2026-09-10 Base 同义值第二轮整理](base-value-synonyms-development-20260910.md)：开发端扫描 93,335 个字段值，识别 17 类字段中的 113 组实际同义值；明确意向 A＝高、B＝中、C＝低。版本、权限、回滚与逐字段再读检查通过，已于 2026-09-11 随 Base 核对批次发布生产，待人工验收。

- [2026-09-10 学生列表与当前线索读取提速](business-subject-read-paths-performance-20260910.md)：补齐范围索引、提前筛选工作候选身份；教师学生列表完整页面预热后约从 3.3 秒降至 0.8 秒，完整读取结果、权限元数据和回滚对照通过。已于 2026-09-11 发布生产，待人工使用验收。

- [2026-09-10 Base 全字段整理开发交付](base-business-fields-development-20260910.md)：主来源 20 张表、345 个字段逐项映射；本机含旧快照共保存 5,360 条来源资料，获客字段接回线索表，原值与既有业务事实保留。开发检查通过，生产现有来源已于 2026-09-11 随 Base 核对批次发布，待人工验收。

- [2026-09-10 首页大屏第二轮提速](dashboard-read-paths-performance-20260910.md)：移除无用读取、减少数据库重复权限计算；统计读取降到约 1 秒，预热后完整页面约 1.4～1.6 秒。读取范围、账号状态与回滚检查通过，已于 2026-09-11 发布生产，待人工使用验收。

- [2026-09-10 首页大屏加载提速](dashboard-loading-performance-20260910.md)：分页请求合并与时区格式化器复用；管理员、教师与历史月份结果逐项一致，开发端完整 HTTP 响应约从 8.1 秒降至 2.9 秒，已于 2026-09-11 发布生产，待人工使用验收。

- [2026-09-10 原表字段与重复提示开发交付](school-source-record-review-development-20260910.md)：按来源查看完整字段、当前页提示可能重复、导入计划逐字段报告；只读权限与回滚、原字段核对和中英文页面启动检查通过，待人工验收，生产未写入。

- [2026-09-10 学生参与权限与分组开发交付](school-collaboration-development-20260910.md)：多人业务角色、参与人持续编辑、主管管理分组与同组只读；权限、回滚、完整名单读取和中英文页面启动检查通过，待人工验收，生产未写入。

- [2026-09-10 教师调班权限生产发布](teacher-enrollment-placement-production-20260910.md)：原班或目标班任课老师满足一边即可调班；写前备份、权限迁移回滚零残留、生产只读授权与运行检查通过，待实际教师操作验收。

- [2026-09-09 0.1.2 生产发布](version-0.1.2-production-20260909.md)：三处点名与开课修复进入生产，版本说明补充团队操作步骤；主分支快进合并且无冲突，功能分支删除。发布检查通过，待团队使用确认。

- [2026-09-09 本地 0.1.2 版本对账与更新](local-version-update-20260909.md)：同步同日已发布的桌面通知代码，保留本地点名与开课修复；本地迁移与定向检查通过，功能说明已整理，待人工验收。

- [2026-09-09 员工 Windows Edge 桌面提醒生产启用](employee-web-push-production-activation-20260909.md)：当前 36 个在职账号可自主开启，生产 WNS 201、专用 Worker、独立邮件告警与业务不变量 postflight 通过；待员工人工体验与持续观察，完整 Gate 未关闭。

- [2026-09-09 退出登录与课次 RPC 上下文修复](auth-rpc-context-hotfix-20260909.md)：退出修复随桌面提醒发布，点名与开课三处修复随 0.1.2 发布；定向回归、类型和生产检查通过，待团队使用确认。

- [2026-09-09 学服补入、档案与分班调整生产发布](school-placement-production-20260909.md)：开发端分班交互已用户验收；8 项迁移完成备份、回滚零残留演练及正式提交，应用已上线，机器 postflight 通过，待生产实际交互验收。

- [2026-09-09 候课、开课提醒与试讲联动生产热修](classroom-rehearsal-hotfix-production-20260909.md)：两笔课堂修复与两条试讲私有频道策略已部署；机器 postflight 通过，按本次要求跳过新备份，待真实设备验收。

- [2026-09-09 秋季首课误点状态恢复](first-session-status-recovery-20260909.md)：4个首课恢复为未上课，误点控制事件保留原始审计后撤销；备课、冻结快照、排课与学生记录保持，持久回读及回放兼容检查通过，待用户刷新验收。

- [2026-09-09 秋季班级后续排课补齐](autumn-class-schedule-completion-20260909.md)：为25班追加350次课，本轮26个已关联课程的班级均为15讲；已有课次、报名及课堂使用记录保留，七至九年级3班待课程与老师确认，待业务验收。

- [2026-09-08 活动页超长查询热修复](activities-uri-hotfix-20260908.md)：关联读取改为每批 100 条，生产原查询 HTTP 414 与分批成功均已复核；应用已部署，待实际页面验收。

- [2026-09-08 学生360生产导入](student-360-production-import-20260908.md)：新增1,454名学生身份，153人关联秋季班级，2人按用户选择待分班；来源、业务、工作范围及9月目标已导入，八九月统计核对通过，待人工业务验收。

- [2026-09-08 秋季C清单生产导入](autumn-classes-production-import-20260908.md)：C01–C29共29班及26个首课已写入并回读核对；16:41按用户确认补齐C26的15次周三排课及两个指定班级的学生，已有课次与报名保持，待业务使用验收。

- [2026-09-08 首批生产员工与教室目录](production-directory-first-batch-20260908.md)：审核后完成 26 个新员工账号、2 个原账号手机号绑定和 17 间新教室；定向 postflight 通过，待员工首次登录与人工验收。

- [2026-09-08 工作区全量快速内部发布](quick-internal-production-20260908.md)：应用 `3dca8078` 与 95 条 migration 已部署，必要 postflight 通过；按本次指令跳过新备份与迁移回滚演练，全量旧测试仍有失败，待内部业务验收。

- [2026 年 9 月老师参与与报名明细](overview-teacher-enrollment-month-20260908.md)：参与名单 12 人一致，来源月份报名从 1 修正为 4 人，补充名单切换；开发端待人工验收。

- [2025 年 12 月／2026 年 1 月开发总览与 base 月仪表盘核对](staff-overview-winter-feishu-20260908.md)：月总量差额、跨批次重复、月份及课程报名口径；只读核对，待修复。

本目录是 R1-Live 与 R1-0～R1-18 的唯一仓库内证据入口。它保存可审查的小摘要、结构化结果和外部 artifact 索引，不把大日志、视频、截图、secret、token、测试凭据或可识别未成年人 PII 提交到 Git。

当前唯一施工阶段为 **R1-Live-2 · 生产单老师试用**。R1-Live 只保留两个结果门：Gate 1 `PASS`、Gate 2 `BLOCKED`；生产端已进入 1 名正式教师小范围试用，首个闭环仍固定为整班点名、持久再读与权限对照，见 [R1-Live 差距表](r1-live.md)与[目标核查及生产备份](r1-live-target-audit.md)。开发端可并行预演产品负责人选中的新功能，但只有开发初验、生产发布及 postflight 各自形成证据后才能提升对应环境结论。原 R1 暂停在 R1-9，SML-0 为独立并行轨道。

## 存储合同

| 载体 | 保存内容 | 保留期 | 访问角色 |
| --- | --- | --- | --- |
| `docs/evidence/r1/` | 阶段摘要、命令结果、失败 ticket、外部 artifact URL/path、SHA-256 和审批记录；单文件原则上不超过 1 MiB | 随 Git 历史永久保存 | 仓库读权限持有者 |
| CI artifact | 可重跑的构建、测试、E2E、性能、无障碍日志和无 PII 截图 | 至少 90 天；进入正式发布包的文件在过期前复制到受控对象存储 | 仓库 Actions 读权限持有者 |
| 受控对象存储 | 恢复/回滚、14 天 RC、生产清理、视觉签收视频等发布关键大件 | 至少保留至 `v1.0.0` 后 365 天；法规或业务要求更长时从其规定 | `swingislee` 及在对应阶段明确登记的复核人 |

开发机临时文件、聊天附件和未记录 hash 的外部链接不构成发布证据。证据含用户数据时先去标识化；无法去标识化的材料只能进入受控对象存储，并在索引记录数据范围和最小访问角色。

## 记录格式

每个阶段使用 `r1-N.md`，每条证据包含：

```text
gate_id, domain, result, measured_value, threshold
commit_sha, migration_head, environment, dataset_manifest
started_at, finished_at, actor, approver
command_or_runbook, artifact_url_or_path, artifact_hash, retention, access_roles
failure_ticket
```

`artifact_hash` 使用 SHA-256。尚未产生的字段写 `not_applicable` 或带 owner/截止阶段的 `pending`，不得留空；硬门需要的字段为 `pending` 时，该 gate 不得记为通过。

## 阶段索引

| 阶段 | 状态 | 日期 | 证据 |
| --- | --- | --- | --- |
| DEV-CLASSROOM · 班级与课堂入口加载 | 开发端已交付，待人工视觉与交互验收 | 2026-09-08 | [班级核心信息流式返回、直接课堂入口、当前页资源优先及完整 H5 包限流](classroom-entry-loading-20260908.md) |
| DEV-SCHOOL-OPS · 获客明细性能 | 开发端已交付，待人工验收 | 2026-09-08 | [来源索引与游标投影、关联键读取、逐条一致性及完整接口计时](overview-acquisition-performance-20260908.md) |
| DEV-SCHOOL-OPS · 学服归属与沟通补漏 | 开发端已交付，待人工验收 | 2026-09-08 | [补齐来源人员与沟通月份、接入确认依据、去重及八九月逐人明细核对](source-staff-attribution-20260908.md) |
| DEV-SCHOOL-OPS · 学生列表查询 | 开发端已交付，待人工验收 | 2026-09-08 | [一次批量事实与数据库分页、按需登记、权限与新旧对照、连续及并发性能](student-list-query-20260908.md) |
| DEV-SCHOOL-OPS · 导入确认标签与月报 | 开发端已交付，待人工验收 | 2026-09-08 | [旧业务补标、来源月份统计、报名与名单分开及袋鼠活动单列；本地回滚、幂等和真实明细核对](source-metric-confirmations-20260908.md) |
| DEV-CW · 正式课程初版 4:3 release | 开发库补齐完成，独立 postflight 通过；生产已有初版，无写入；粗版待人工验收 | 2026-09-08 | [1,135 个初版 release、71,553 页、已有草稿与冻结版本保护、写前备份及生产零缺失核对](courseware-initial-4x3-20260908.md) |
| DEV-SCHOOL-OPS · 四五月总览核对 | 只读核对完成；日期、月份与来源范围差异已定位 | 2026-09-08 | [复算 base 四五月主指标与学服明细，定位获客日期规则、五月缺日期和跨月记录及仪表盘配置差异](staff-overview-apr-may-feishu-20260908.md) |
| DEV-SCHOOL-OPS · 来源业务衔接 | development available；pending source comparison and product acceptance | 2026-09-07 | [主要工作表 4,864 条来源行接入现有首联、测评、报名分班与续报；人员映射、事务回滚、权限与页面启动检查](business-source-continuation-20260907.md) |
| DEV-SCHOOL-OPS · 测评学服与 360 修复 | development available；pending product acceptance | 2026-09-07 | [恢复来源学服显示与筛选，兼容既有导入 UUID；实际 360、逐题页面与匿名边界复核](assessment-import-support-and-360-20260907.md) |
| DEV-SCHOOL-OPS · 来源报名阶段与多次预约 | development available；pending product acceptance | 2026-09-07 | [明确报名确认前序阶段，标准班型对应等级，保留每次预约与资料缺项；本机修复、回滚及真实读取](source-assessment-completion-repair-20260907.md) |
| DEV-SCHOOL-OPS · 总览统计与当前学期在读 | development available；pending visual acceptance | 2026-09-08 | [周／月接入实际业务日期与报名登记，当前学期完整在读名单；分页、归属、权限及真实页面检查](staff-overview-source-20260908.md) |
| DEV-SCHOOL-OPS · 总览历史周期与当前状态 | development available；pending visual and interaction acceptance | 2026-09-08 | [上期复盘、当前进展与历史日期选择；区分周期统计和当前待办／在读，校验完整周期及实际页面](staff-overview-periods-20260908.md) |
| DEV-SCHOOL-OPS · 紧凑总览与展示名单 | development available；pending visual and interaction acceptance | 2026-09-08 | [修复日历标题、配置学服展示名单、三栏紧凑表格及班容切换](staff-overview-compact-20260908.md) |
| DEV-SCHOOL-OPS · 六月总览核对 | 只读核对完成；月份、日期及来源范围差异已定位 | 2026-09-08 | [按 base 配置复算六月总计、学服、组别与年级，定位缺日期、跨月／跨年及诺访目标卡筛选差异](staff-overview-june-feishu-20260908.md) |
| DEV-SCHOOL-OPS · 八月总览核对 | 只读核对完成；37 张基准图表复现，日期解析及统计差异待处理 | 2026-09-08 | [5,212 条来源档案逐条一致；定位报名、到访、诺访、获客差额与动态英语／诺访目标配置](staff-overview-august-feishu-20260908.md) |
| DEV-SCHOOL-OPS · 五项经营指标来源定位 | 只读定位完成；统计修正与业务验收待完成 | 2026-09-08 | [逐条定位九月报名旧名册回流、测评与沟通定义差异、历史到访和邀约归月及来源混用](funnel-metric-source-diagnosis-20260908.md) |
| DEV-SCHOOL-OPS · 区块展示设置 | development available；persistence checks passed；pending visual and interaction acceptance | 2026-09-08 | [学服、老师参与、班级容量独立展示设置；中文来源署名保存修复及实际重载验证](staff-overview-panel-settings-20260908.md) |
| DEV-SCHOOL-OPS · 总览清理与飞书对照 | 开发端已交付；获客 92、报名 7、到访 31；缺日期报名与在读名单待核对 | 2026-09-08 | [固定 1,391 行测试记录清理、来源日期与报名去重、老师参与归属及在读逐人差异检查点](staff-overview-cleanup-feishu-20260908.md) |
| DEV-SCHOOL-OPS · 7 月总览来源核对 | 只读核对完成；月份标签、日期及重复登记差异待业务核定 | 2026-09-08 | [49 个图表原配置复算、5,212 条来源完整性、报名 20／到访 47／诺访 71／获客 357 的逐条差额与旧筛选配置](staff-overview-july-20260908.md) |
| AIXUEXI-DELTA-20260907 · 爱学习两讲增量热更新 | production schema/content deployed；machine postflight passed；pending product acceptance | 2026-09-07 | [两条迁移、完整回滚零残留演练、五/六年级各29页与双轨release、115个对象校验、业务不变量及同主机写前备份](aixuexi-incremental-production-20260907.md)；现有服务连续运行，应用版本保持原值 |
| DEV-WEB-PUSH-1 / PUSH-P5 · 员工桌面 Web Push 生产暗部署 | production schema/app deployed；dark-state machine postflight passed；employee test not authorized | 2026-09-04 | [候选 `bea3d111…`、生产基线刷新、PostgreSQL 写前备份、migration rollback/零残留 rehearsal、应用原子 release、schema formal、暗态业务/Storage/错误不变量与公网 postflight](employee-web-push-p5-preflight.md)；feature=false、integration disabled/secret null、cohort/subscription/delivery/job=0、Worker inactive，只有 `PUSH-G5` 全部通过并再次获得明确确认后才能进入员工测试 |
| DEV-CW-1 Step 8E · 统一课件工作区窄范围生产发布 | production schema/app deployed；machine postflight passed；pending production product acceptance | 2026-09-03 | [候选 `8c50b48…`、PostgreSQL 写前备份、6 migration 回滚／正式提交、原子 release、数据零漂移与机器 postflight](courseware-workspace-production.md)；[部署候选证据](courseware-workspace-release-candidate.md)；[Step 8D 生产 inventory](courseware-workspace-production-inventory.md) |
| HOTFIX-20260831 · 课件 session 修复集中发布 | production app + 爱学习秋季 170 讲 source-runtime upgraded；machine postflight passed；pending production product acceptance | 2026-08-31 | [来源 iframe render 串行化、稳定签名 URL/相邻预热、X+ 首页视频投影、三包 5442 页版本化升级与精确 head 回退清单](courseware-session-fixes-production-20260831.md) |
| HOTFIX-20260830 · 讲次课件预览翻页性能 | production app deployed；machine postflight passed；pending production product acceptance | 2026-08-30 | [来源 `50a1648` 到生产基线适配候选 `a165004`、页级读取/缓存/相邻预取/runtime iframe 复用、10/10 Vitest、双 production build、原子发布、数据零漂移与回退点](courseware-preview-performance-hotfix-production.md) |
| HOTFIX-20260829 · 教师微课来源预览 | production app deployed；machine postflight passed；pending production product acceptance | 2026-08-29 | [空 kind 绑定按钉死 H5 对象 kind/hash 解析、通用审核入口转不可变微课快照、17/17 Vitest、固定账号 Playwright 2/2、应用-only 原子发布与数据零漂移](teacher-microcourse-source-preview-hotfix-production.md) |
| HOTFIX-20260829 · 自研课堂互动状态同步 | production app deployed；machine postflight passed；pending real iPad classroom acceptance | 2026-08-29 | [game-page-v1 镜像根因、100ms 合并广播、H5/3D fail-closed 审计门、72/72 Vitest 与控制页→展示页 Chromium 2/2](classroom-interaction-sync-hotfix.md)；[应用-only 原子发布、数据零漂移与回退点](classroom-interaction-sync-hotfix-production.md) |
| HOTFIX-20260829 · 管理员自授员工岗位 | production schema/app deployed；machine postflight passed；pending production admin self-assignment acceptance | 2026-08-29 | [目标 preflight、最终 PostgreSQL 写前备份、首轮 ACL fail-closed 与零残留、修正后 rollback/formal、原子 release、HTTP/ACL/业务/Storage/备份 postflight](admin-self-role-hotfix-production.md) |
| HOTFIX-20260829 · 自由班自动排课与 H5 透明层 | production app deployed；machine postflight passed；pending production product acceptance | 2026-08-29 | [精确提交边界、应用-only 发布、无 DB/Storage 漂移、localhost-only 来源工具边界与非浏览器 postflight](free-class-h5-hotfix-production.md) |
| DEV-ORG-1 / DEV-DASH-1 / DEV-DASH-2 · 机构场地、后台职能导航与表格语义 | production schema/app deployed；machine postflight passed；pending product acceptance | 2026-08-29 | [目标 preflight、PostgreSQL 写前备份、7 migration 回滚/零残留与正式事务、结构化教室回填、原子 release、ACL/HTTP/业务不变量/error postflight](organization-dashboard-production.md) |
| DEV-CW-SOURCE-1 · 来源课件运行时与暑期 A+ | machine postflight/browser visual smoke passed；production deployed；pending product acceptance | 2026-08-28 | [全量生产备份、来源运行时迁移、秋季三包升级、暑期 A+ 两讲/13 空占位、双 release 与两讲 4:3 互动实看证据](courseware-source-runtime-production.md) |
| DEV-TMC-1/2 · 普通教师短期微课与课次多方案 | production schema/app deployed / flag v2 true；教研入口与来源预览 hotfix 已发布；pending product acceptance | 2026-08-29 | [首版闭环、多方案协作/选用、班级重新启用、SQL/Vitest/Playwright/CI、全量备份、迁移、双 release 与 postflight 证据](teacher-microcourse-dev.md)；[教研课次页入口 hotfix](teacher-microcourse-research-entry-hotfix-production.md)；[来源预览 hotfix](teacher-microcourse-source-preview-hotfix-production.md) |
| POST-LIVE-OPS-02 · 班级用途与单次活动边界 | production schema/app deployed；machine postflight passed；pending product acceptance | 2026-08-28 | [迁移重编号、当前数据库备份、rollback/formal、原子 release、权限/业务不变量与 HTTP postflight](classroom-offering-activities-production.md) |
| 课堂体验升级 M0–M5 | Stage A/B1/B2 passed；Stage B3 remediation deployed / H5 flag false / pending production acceptance | 2026-08-26 | [开发端验收摘要](classroom-experience-dev.md)与[M5 生产分段启用](classroom-experience-m5-candidate.md)：隔离提交 `964ca5e` 已部署共同 bridge、`cw_h5_input_profiles` 与外层透明无边框、强调色 SVG + 滑轨的 `112×44px` Smart 二态开关；board/input/layout=`v2/true`，H5=`v3/false`，空档案表不授权现有 package。新鲜 PostgreSQL-only 备份、migration rollback/formal、双 build、原子切换和独立 postflight 通过；生产人工验收与逐包档案登记仍待完成 |
| R1-Live | Gate 1 passed；Gate 2 single-teacher production trial/blocking；讲次课件预览性能、课堂同步、教师微课、来源课件、班级/活动、DEV-ORG/DEV-DASH 与既有 hotfix 均保持待对应产品/真实设备验收 | 2026-08-30 | [真实教师点名闭环差距表、手机号 P0、账号中心与课堂发布证据](r1-live.md)；[目标核查、应用/数据库发布、正式管理员交接、manifest 激活、真实教师注册/岗位保护与当前生产备份](r1-live-target-audit.md)；[讲次课件预览性能 hotfix](courseware-preview-performance-hotfix-production.md)；[教师微课来源预览 hotfix](teacher-microcourse-source-preview-hotfix-production.md)；[课堂互动同步 hotfix](classroom-interaction-sync-hotfix-production.md)；[管理员自授岗 hotfix](admin-self-role-hotfix-production.md)；[教研课次页入口 hotfix](teacher-microcourse-research-entry-hotfix-production.md)；[自由班/H5 hotfix](free-class-h5-hotfix-production.md)；[机构场地与 Dashboard 生产证据](organization-dashboard-production.md)；[教师微课与多方案生产证据](teacher-microcourse-dev.md)；[来源课件运行时与暑期 A+ 生产证据](courseware-source-runtime-production.md)；[班级/活动分类生产证据](classroom-offering-activities-production.md)；[仓库写入目标保险丝](../../runbooks/r1-write-target-policy.md)；[正式对象保护 manifest](../../runbooks/r1-live-object-protection-manifest.md)。生产 current/previous=`20260830-080555` / `a165004…` 与 `20260830-045421` / `76f0f9a…`，ledger/head=`236 / 20260830000700_teacher_microcourse_editor_unification`；本轮 profiles/classrooms/sessions/microcourses/selected-session/teacher/research/Storage objects/bytes=`14/4/19/3/3/6/4/125917/51524182412`，`operational_errors=1956` 且无发布增量。preflight 已发现 DEV-TMC-4 schema/app 在本轮前进入生产，先前部署证据仍待对账；生产课程冷/热翻页、教师微课课程切换、真实 iPad replay、管理员实际自授岗、真实手机号登录、正式教师点名保存/再读与权限对照仍待人工闭环 |
| R1-0 | passed | 2026-07-28 | [规划真相源与发布边界冻结](r1-0.md) |
| R1-1 | passed | 2026-07-28 | [机构配置、规则与 Feature Flag](r1-1.md) |
| R1-2 | passed | 2026-07-28 | [Jobs、通知、文件与外部集成](r1-2.md) |
| R1-3 | passed | 2026-07-28 | [账户、安全、同意与管理员支持](r1-3.md) |
| R1-4 | passed | 2026-07-28 | [Work-items 混合模型与轻审批](r1-4.md) |
| R1-5 | passed | 2026-07-31 | [学生/家庭门户、课堂连续性与集成 CI 总门](r1-5.md) |
| R1-6 | passed | 2026-08-01 | [教学成果、阶段报告、通知与客户读取](r1-6.md) |
| R1-7 | passed | 2026-08-01 | [初始化、导入、质量、修复与导出](r1-7.md) |
| R1-8 | passed | 2026-08-12 | [财务安全关闭](r1-8.md)；`BUG-R1M-024` 与 `BUG-R1M-025` 已由迁移 `20260804000100` 修复，并在 commit `e231d7c` 复验：`pnpm r1:test` 15 个文件、99 项全绿，`SUPABASE_DB_SSH=xiaomi pnpm r1:db-audit` 的 12 个 SQL 断言文件全部通过并输出 `R1-8 finance safe-close assertions passed`；脚本均在事务中回滚，不留写入。具体 artifact 与 hash 由 r1-8 阶段证据登记 |
| R1-9 | paused for R1-Live | 2026-08-14 | [P6-AIX-2 爱学习 v31 多难度子门](r1-9-aixuexi-courseware.md)已关闭，开发库为 G+/X+/A+ 12 门/170 讲/5442 页；[两套课程来源 manifest v4 与受控导出 runner](r1-9-courseware-source-manifest.md)已同步 102 门/1305 讲/2610 条 Production 1.0 目标。批准副本、E 系列 provenance、真实 inventory、Storage/H5 字节审计和非执行者复核仍 pending；除首个真实课次所用讲次可读外，不阻塞 R1-Live |
| R1-10～R1-18 | queued after R1-Live | — | Notebook 两个数据库子门和非五模块 Playwright 本地基线等已完成增量继续保留。完整公开模块、视觉、全量 E2E、指标、清理/release、恢复和 14 天观察移入 R1-Live 后；R1-15 旧“只保留管理员”planner 在增加正式对象保护 manifest 前不可执行，R1-18 不得删除 R1-Live 真实数据 |
