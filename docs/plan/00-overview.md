# Mathin 整体规划 · 00 产品总览与规划索引

> **规划状态**：`active`
>
> **用途**：固定 1.0 产品范围、视觉语言、数据权威和规划读取顺序。
>
> **阶段来源**：`04-roadmap.md` 顶部的“当前施工阶段”。
>
> **核对日期**：2026-07-31；依据代码、迁移、内容目录、CI 与 doc 00～26。

## 1. 1.0 产品合同

Mathin 以 Terms 数学概念及其关系为内容中心。1.0 同时发布下列对象：

| 对象 | 用户执行的动作 | 系统产生的结果 |
| --- | --- | --- |
| Terms | 浏览概念、查看前置/后继关系、沿学习线探索 | 概念页、知识关系、搜索结果和跨模块链接 |
| Story | 从章节入口连续阅读或交互到结尾 | 一个完整数学故事章节，并关联所涉及的 Terms |
| Games | 进入游戏、提交成绩、查看排名 | 3 个可玩游戏；需要排名的成绩由服务端验证 |
| Minds | 阅读数学人物/思想文章、跳转相关概念 | 2 篇中文文章及其 Terms 关系 |
| Tools | 独立使用工具或嵌入内容/课堂 | 2 个工具的独立页、嵌入页和输入结果 |
| Notebook | 私人写作、发布、撤回、审核、公开阅读和互动 | 私有笔记与公开文章使用同一身份和权限体系 |
| 学校运营 | 管理学生、家庭、员工、课程、班级、排课、考勤、作业、成果及启用时的财务 | Dashboard 工作流、审计记录、通知和角色门户 |
| 内容发布 | 编辑、审核、发布、撤回 Terms/Story/Minds/Notebook 和课程课件 | 可追溯内容版本；课堂只读取不可变 release |

Classroom、Whiteboard 和 Courseware Studio 承载教学与课件制作。它们与 Dashboard 属于对内系统，不减少六个对外模块的 1.0 范围。

Story、Minds、Games、Tools 和 Notebook 使用稳定 ID 关联 Terms。课程研发复用相同概念标识；改 slug 或删除内容前检查反向引用和重定向。

## 2. 全站视觉语言

小王子世界观是首页、公开内容、身份页和运营工作区的共同视觉基础。`public/Main.png` 提供 B-612 主视觉和基础取色；新插画使用原创或用户拥有的资产，不临摹特定出版版本的构图。

| 强度 | 页面 | 必须出现 | 限制 |
| --- | --- | --- | --- |
| 场景级 | 首页；Story/Games/Minds/Terms/Tools 首页 | B-612 或对应星球场景、低饱和插画、星轨/地平线等空间关系、`ThemePageIdentity` | 首屏只保留一个叙事焦点；插画不得遮挡入口和标题 |
| 内容级 | 概念/文章/游戏/工具详情、Notebook、登录注册、帮助/错误/空状态 | 纸张、墨线、文楷/衬线、圆点星轨、四角星或该模块母题中的至少一项 | 每屏装饰星 3～5 颗；内容区最多一个专属轻动效 |
| 工作区级 | Dashboard、Classroom、Whiteboard、Courseware Studio | `--paper/--ink/--line`、星夜暗色、手绘线宽、圆角、书卷字体；品牌区/空状态/帮助区保留一个叙事锚点 | 表格、表单、课堂和画布不放星球装饰；信息密度、对比度和操作速度优先 |

五个公开星球的映射由 doc 05 固定：Story=地球、Games=国王星、Minds=点灯人星、Terms=地理学家星、Tools=商人星；首页=B-612。Notebook 使用“旅途笔记”语言，不新增第六颗主题星球。

全站共享纸白/星夜、墨色、低饱和取色、1～2px 线条、圆点星轨、四角星、霞鹜文楷和克制运动。禁止大面积霓虹、高饱和渐变、拟物阴影、无业务含义的漂浮动画和在数据表中散布装饰图形。设计 token 与组件规则见 doc 01，场景映射见 doc 05，视觉发布门见 doc 25。

## 3. 语言与内容

| 项目 | 1.0 规则 | 验证 |
| --- | --- | --- |
| UI | 导航、表单、错误、空状态、通知、邮件模板和关键元数据同时提供 zh/en | `messages/{zh,en}.json` key 100% 相等；关键 UI 无硬编码单语文案 |
| 默认语言 | 中文；URL 始终含 `/zh` 或 `/en` | locale-aware 路由、跳转和 canonical 正确 |
| 英文课程/文章 | 允许在 1.0 后补齐 | `/en` 保留英文 UI；正文显示明确的中文内容标记，或显示英文“尚未发布”状态并链接 `/zh`，不得静默混排或返回坏链 |
| 内容关系 | zh/en 共用稳定实体和关系，翻译分别记录状态 | 不复制两套无关联 Terms、课程或文章实体 |

## 4. 路由、身份与数据权威

| 范围 | 当前合同 |
| --- | --- |
| 公开入口 | `/[locale]/story`、`games`、`minds`、`terms`、`tools`；Notebook 公开详情允许未登录阅读 |
| 登录入口 | `/[locale]/notebook/me`、`classroom`、`whiteboard`、`dashboard/**`、`studio/courseware/**` |
| 顶层身份 | `student`、`parent`、`staff`、`admin`；教师、教务、教研、学辅、销售、财务属于 staff 权限/角色 |
| 服务端认证 | `requireUser(locale)` → `supabase.auth.getUser()`；Proxy 只刷新 Cookie 和做乐观跳转 |
| 授权 | 数据库 RLS；前端隐藏按钮不构成授权 |
| 业务状态 | 领域表和领域 RPC；今日工作、通知、搜索和统计只读取投影 |
| 课程发布 | 可编辑文档/revision/binding 与不可变 release 分层；课堂读取 track head 指向的 release |
| 正式数据基线 | 只保留 1 个生产管理员；删除测试运营数据；保留 E 系列 865 讲的 16:9/4:3 源资源；重建 1730 条 `release_no=1` |

现行显式路由覆盖旧文档中的“九板块统一动态路由”描述。新增入口时同时更新路由、Proxy/鉴权、导航、sitemap、SEO、registry 和 zh/en messages。

## 5. 规划读取规则

| 顺序 | 文件/证据 | 用途 |
| --- | --- | --- |
| 1 | `AGENTS.md` | 工程、安全和任务前置约束 |
| 2 | `00-overview.md` | 产品、视觉、语言和数据合同 |
| 3 | `04-roadmap.md` | 唯一当前阶段、依赖和退出条件 |
| 4 | `25-production-1.0-product-completeness.md` | 实际数量、成熟度、业务合同、发布门和生产初始化 |
| 5 | 任务相关专题文档 | 状态头声明范围内的设计与历史依据 |
| 6 | 代码、迁移、生成类型和自动验证 | 判断已经落地的证据；发现冲突时先更新 active 文档 |

| 状态 | Agent 行为 |
| --- | --- |
| `active` | 必读；随阶段和事实更新 |
| `reference` | 按任务读取；正文不是当前任务清单 |
| `complete` | 阶段已竣工；新变更进入 R1 或新阶段 |
| `partial` | 只实施状态头及 doc 25 收录的剩余项 |
| `deferred` | 当前发布不实施 |
| `superseded` | 只用于追查历史决定 |

## 6. doc 00～26 状态索引

| 文档 | 状态 | 有效内容 |
| --- | --- | --- |
| `00-overview.md` | active | 产品、视觉、语言、数据和规划合同 |
| `01-design-system.md` | reference | 全站小王子视觉 token、字体、线条、动效和组件 |
| `02-pages.md` | reference | 页面和交互目标；现行路由优先 |
| `03-data-and-tech.md` | reference | 数据、鉴权、RLS 和 registry |
| `04-roadmap.md` | active | R1 顺序、依赖、产物和退出证据 |
| `05-planet-themes.md` | reference | B-612、五星球、Notebook 和工作区视觉强度 |
| `06-knowledge-universe.md` | partial | Terms 知识星系；关系和发布质量待收口 |
| `07-p3-notebook.md` | complete | Notebook P3 历史实现；1.0 验收见 doc 25 |
| `08-p4-classroom-whiteboard.md` | complete | Classroom/Whiteboard P4 历史实现 |
| `09-p5-story.md` | partial | Story 壳已落地；完整章节未落地 |
| `10-school-backend.md` | complete | P4B 数据与业务地基；历史 UI 已替代 |
| `11-p4c-dashboard-refit.md` | complete | P4C 历史记录；角色磁贴已替代 |
| `12-p4d-student-lifecycle.md` | complete | P4D 学生生命周期领域地基 |
| `13-foundations-and-hardening.md` | complete | P4E 安全、审计、通知与验证地基 |
| `14-navigation-and-experience.md` | partial | P4F 已落地项和仍适用的体验债务 |
| `15-discoverability-and-delivery.md` | partial | P4G 已落地项；缓存等后续项 |
| `16-p6-courseware-platform.md` | partial | P6-1～6 主体；P6-9 与正式基线待完成 |
| `17-Supabase_Mathin_公网部署实施计划.md` | partial | Linux 生产、备份、恢复和公网部署 |
| `18-p4h-teaching-operations-experience.md` | complete | P4H Dashboard 历史记录 |
| `19-p4i-final.md` | complete | P4I 工作流、对象页和今日工作设计 |
| `20-ui-layout-refit.md` | complete | UI 验收基线 |
| `21-dashboard-unified-canvas-command-panel-refactor.md` | complete | UI-L1 坐标系与命令面板 |
| `22-dashboard-route-information-architecture-refactor.md` | complete | UI-L2 路由信息架构 |
| `23-dashboard-object-pages-workspaces-rebuild.md` | complete | UI-L3 对象页和工作区 |
| `24-dashboard-visual-interaction-closeout.md` | complete | UI-L4 工程收口；人工签收进入 R1 |
| `25-production-1.0-product-completeness.md` | active | 1.0 事实、缺口、发布门和生产初始化 |
| `26-teacher-workflow-upgrade.md` | partial | 左侧备课步骤、右侧常驻课件预览、板书解析与结构化教案；独立教案管理入口和派生输出待补 |

## 7. 当前发布纪律

- 当前子阶段以 doc 04 顶部为准。
- R1 实际责任映射由 doc 25 §7.1 维护；阶段证据统一从 `docs/evidence/r1/README.md` 索引，Agent 只能作为执行者，不能代替人员 owner 或批准人。
- R1-15 在生产快照的隔离副本演练数据清理；R1-18 经人工批准后处理正式生产。其他阶段禁止执行账号、班级、订单或 release 删除。
- 阶段关闭时更新实现证据、专题文档状态头、doc 04、doc 25 和 README，并运行 `pnpm plan:audit`。
- 英文长内容、原生移动端和 `cacheComponents` 迁移可延后；安全、数据正确性、六个对外模块和全站小王子视觉验收不可延后。
