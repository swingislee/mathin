# 现行设计与交互规范

本文规定现在应呈现的效果与行为；代码实现这些规范，不能靠阅读现有代码反推产品方向。实现与人工确认范围见 [当前状态](current.md)。

## 视觉与连续工作区

公开首页和 Story／Games／Minds／Terms／Tools 入口采用小王子世界观，插画、星球与路径承担导航和层级。阅读页以正文、数学与插图为主。工作区保持密度与对比度，表格、表单、课堂与课件画布不加叙事装饰。

Dashboard、Classroom、Whiteboard、Courseware Studio **默认使用连续工作区，不用 Card 拼装页面**：

- 页面身份放 DashboardPage／ObjectBar，搜索与业务动作放 DashboardCommandPanel；页面按钮和批量按钮使用 actions／selection 槽，表格外壳直接从 Table 开始。
- 全选放选择列表头；数据列在表头筛选、排序，命令区保留跨列搜索与页面筛选。滚动时固定表头。分页放表格下方，显示当前页／总页数、总行数和每页数量；改每页数量回第一页并保留筛选。
- 正文、栏位、目录、筛选集合、统计摘要与表格外层透明，以对齐、留白和结构线区分；标题、说明、表单、只读摘要和空状态各归所属区域。空状态保留原区域尺寸和边界。
- 分栏工作台是一块连续画布，只在并存栏位之间分隔。每条线由一个结构拥有者绘制：表格外边界归 DashboardTableShell，表头与行线归 Table；section 不再叠加边框。
- Card 仅用于产品负责人明确给出的设计，或确需独立搬运、选择、并列比较的对象，并说明对象语义。教师微课的页面栏、composition 编辑工作面及课堂学生简卡是已明确保留的例外。

## 色彩、字体与表面

组件使用语义 token。品牌色取自 public/Main.png；中文正文、标题与 UI 使用自托管文楷，英文使用 Iowan Old Style／Palatino／Georgia 衬线栈。字体分片是同一字体的按字下载资源。

| Token | 浅色 | 深色 |
| --- | --- | --- |
| paper／ink | #FFFDF8／#29251F | #191D2B／#F2EDDF |
| muted／line | #766F65／#E8E1D5 | #9BA0B0／#333A4E |
| card | #FFFFFF | #212637 |
| moon／star | #FEEDB9／#FFEBBD | #D9BE7E／#E8D9A8 |
| crater | #CBAB8F | #8F7A64 |
| rose／rose-deep | #E55C60／#C94A4F | #E06A6E／#C94A4F |
| leaf／leaf-deep | #BBCF87／#6F8B48 | #8FA968／#A9C284 |
| cheek | #FBC9C3 | #B98883 |

表格、表头、普通行与固定列使用不透明 --card：浅色纯白、深色星夜。Dashboard 数据工作区关闭全页纸纹，公开页面保留纸感。蓝色继续表达既定业务或画布内容，通用表格选择使用浅黄。

勾选、展开、当前处理和键盘焦点独立建模；填充不反复叠深。下表百分比表示 moon 与 card 的色彩混合比例，显式深色与系统深色一致：

| 状态／token | 浅色 | 深色 |
| --- | --- | --- |
| 悬停 followup-hover／table-hover | moon 10% | moon 5% |
| 勾选 followup-checked／table-selected | moon 22% | moon 9% |
| 当前处理 followup-edit | moon 38% | moon 13% |
| 详情 followup-detail | moon 14% | moon 5% |
| 连续外缘 followup-outline | #BC963F，1px | moon，1px |
| 结果按钮文字 followup-choice-ink | ink | paper |

主行与详情共用连续轮廓；分组摘要保留完整边界；焦点环独立，展开控件承接键盘焦点。登记按钮与选择器完整显示标签，空间不足时换行，详情按容器宽度排布并保留业务圆点进度。

## 行下展开、加载与键盘

记录行使用 FollowupRecordRow／FollowupInlineDetails，列表入口使用 DashboardInlineEntry，共同使用 DashboardInlineDetailBoundary。下载模块、异步读取和延迟构造都在当前详情内等待；外围表格、焦点、已打开内容和草稿保持挂载。展开、关闭只更新本地行状态；保存执行领域权限与刷新规则。一个备注只有一份草稿和一个活跃编辑位置。

| 按键与焦点 | 行为 |
| --- | --- |
| ↑／↓ | 按显示顺序贯通可见父行及展开子表 |
| Alt＋↑／↓ | 同层记录间移动，跳过内部详情 |
| 行／详情背景上的 Tab／Shift＋Tab | 切换同一详情内的并列表，恢复目标表当前行；没有相邻表时沿原生 Tab 顺序 |
| 输入框、链接、按钮、下拉或弹层 | 保留控件自身按键行为 |
| Esc | 逐层折叠并返回父行 |

内层表独立维护当前记录、草稿与保存保护；隐藏但保留挂载的详情不参加导航。使用共用 DashboardRowDisclosure 与 DashboardTablePagination。

## 首联保护基线

首联沿用已确认的紧凑摘要、行下详情、圆点进度和保存位置。修改首联效果需有产品负责人针对首联的要求；共享组件扩展保持其原行为。后续沟通、邀约和测评参考相同密度与连续录入方式，按各自业务内容设计。

- **图标和颜色：** 微信使用固定 SVG 与勾／叉、leaf；A／B／C 意向使用 HeartPulse，cheek 填充、rose 35% 与 cheek 混合描边；承接使用 Signpost，moon 填充、crater 描边。标注图标 20px，心跳与路标描边 2，保留悬停与无障碍名称。
- **快捷键：** 1 未接通、2 已沟通、3 暂缓／下次联系、4 号码无效，摘要与详情共用；Ctrl/Cmd＋Enter 显式保存。选结果、切行、点击姓名均不隐式提交。
- **草稿与回执：** 切换结果保留其他字段，同一份备注贯穿摘要与详情；普通保存停在当前行，“保存并下一位”在主提交成功后前进。失败保留输入，本轮成功记录仍能回看。
- **身份：** 姓名打开学生 360；未建档显示待创建。保存有效首联（已沟通或暂缓）时，同事务创建或关联最小 Student；不自动生成家庭、监护关系或账号。疑似重复保留沟通并提示档案待核对，按原权限处理。

## SVG、提示与手机

工具栏、对象旁动作与课堂状态按钮用 SVG＋语义颜色；操作说明放悬停提示、键盘聚焦提示和无障碍名称。固定位置、统一轮廓与状态反馈承担识别，首屏不增加说明段或一排重复文字标签。**范围例外明确保留：** 登记表单按钮／选择器完整显示业务标签；课堂“补齐未登记”条和已登记姓名后显示完整状态名。

Table mobileLayout="stacked" 在小于 64rem 时把同一记录排成连续纵向字段：姓名、状态和勾选置顶，字段名与内容对应，详情紧接记录下方。表头筛选、排序、全选组成可换行区域。手机与桌面使用同一行、编辑器和草稿，桌面排列保持稳定；手机授权范围包括首联，具体增量的人工确认单独记录。

## 实现入口

共用 UI 先使用仓库已有 shadcn 组件；字段和业务含义由领域提供。页面结构在 src/features/school/dashboard-page/，表格在 src/components/ui/table.tsx，主题在 src/app/globals.css，zh/en 文案在 messages/。教具、课件与课堂规则见 [教学](workflows/teaching.md)；版本和验收经过放在 [归档](../archive/README.md)。
