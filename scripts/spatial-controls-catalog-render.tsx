import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Droplets, Eye, FoldHorizontal, Move, Move3D, Rotate3D, RotateCcw, RotateCw, Scissors, Shapes, Boxes } from "lucide-react";
import { SPATIAL_ACTIONS, type SpatialActionId } from "../src/features/tools/spatial-interaction/actions";
import { SpatialActionIcon } from "../src/features/tools/spatial-interaction/SpatialActionIcon";
import { SpatialAxisIcon, SpatialMarkIcon, SpatialViewIcon } from "../src/features/tools/spatial-interaction/SpatialWorkbenchControls";
import { SPATIAL_ALL_VIEWS } from "../src/features/tools/spatial-interaction/SpatialViewButtons";
import { SPATIAL_ICON_CHANGES, SPATIAL_WORKBENCH_INVENTORY } from "../src/features/tools/spatial-interaction/control-inventory";
import { CUBE_MARK_SHAPES } from "../src/features/tools/spatial-lab/cube-structures-contract";

const oldIcons = { Droplets, Eye, FoldHorizontal, Move, Move3D, Rotate3D, RotateCcw, RotateCw, Scissors, Shapes, Boxes };
const groups: Record<string, string> = { camera: "视角", object: "对象", display: "显示", surface: "表面", inspect: "观察与测量", fold: "折叠", dice: "骰子", soma: "索玛", capacity: "容积", workspace: "场景", recording: "过程", parameter: "参数／通用命令" };

/** 使用正式组件渲染 SVG；对照文档不维护第二份 path。 */
export function renderSpatialControlsCatalog(usages: Record<string, readonly string[]>) {
  const body = renderToStaticMarkup(<main>
    <header><p>Mathin · 3D 教具空间</p><h1>功能与 SVG 图标对照</h1><p>开发端整理 · 待人工视觉验收。所有新图由实际共用组件生成；这里的图不是功能按钮，不会修改场景。</p>
      <nav><a href="#changes">语义冲突</a><a href="#workbenches">舞台功能</a><a href="#icons">全部动作</a><a href="#parameters">参数图形</a></nav></header>
    <section id="changes"><h2>本轮图标含义调整</h2><table><thead><tr><th>功能</th><th>原图</th><th>统一后</th><th>区分依据</th></tr></thead><tbody>
      {SPATIAL_ICON_CHANGES.map((item) => <tr key={item.action}><th>{SPATIAL_ACTIONS[item.action].zh}</th><td>{item.previous.map((old) => <span className="sample" key={old}>{createElement(oldIcons[old])}<small>{old}</small></span>)}</td><td><span className="sample current"><SpatialActionIcon action={item.action} /><small>{item.action}</small></span></td><td>{item.note}</td></tr>)}
    </tbody></table></section>
    <section id="workbenches"><h2>舞台功能与共用范围</h2><p>9 个操作现场覆盖工具库的 7 个独立 3D 工具；自由折纸、长方体／三棱柱展开位于展开图入口中。图标栏从对应源码提取，不另维护一份按钮表。</p>
      {SPATIAL_WORKBENCH_INVENTORY.map((stage) => <article key={stage.id}><h3>{stage.name}</h3><p>{stage.features}</p><div className="strip">{(usages[stage.id] ?? []).map((action) => <span key={action} className="sample" title={SPATIAL_ACTIONS[action as SpatialActionId].zh}><SpatialActionIcon action={action as SpatialActionId} /><small>{SPATIAL_ACTIONS[action as SpatialActionId].zh}</small></span>)}</div><p className="muted">共用：{stage.shared}</p><details><summary>源码入口</summary>{stage.files.map((file) => <code key={file}>{file}<br /></code>)}</details></article>)}
    </section>
    <section id="icons"><h2>全部动作放在一起比较</h2><p>动作入口按语义统一。参数中的加减、方向箭头、关闭等基础符号可以复用；“整体移动／移面”“展开／复原”等不同教学动作使用不同图形。</p>
      <table><thead><tr><th>SVG · 18 / 28 px</th><th>功能 / English</th><th>类别</th><th>唯一语义 ID</th></tr></thead><tbody>{Object.entries(SPATIAL_ACTIONS).map(([key, value]) => <tr key={key}><td><span className="comparison"><SpatialActionIcon action={key as SpatialActionId} className="small" /><SpatialActionIcon action={key as SpatialActionId} /></span></td><td>{value.zh}<small>{value.en}</small></td><td>{groups[value.group]}</td><td><code>{key}</code></td></tr>)}</tbody></table>
    </section>
    <section id="parameters"><h2>共用参数图形与数据缩略图</h2><div className="strip">{SPATIAL_ALL_VIEWS.map((view) => <span className="sample" key={view}><SpatialViewIcon view={view} /><small>{view}</small></span>)}{(["x", "y", "z"] as const).map((axis) => <span className="sample" key={axis}><SpatialAxisIcon axis={axis} /><small>{axis.toUpperCase()}</small></span>)}{CUBE_MARK_SHAPES.map((shape) => <span className="sample" key={shape}><SpatialMarkIcon shape={shape} /><small>{shape}</small></span>)}</div>
      <p>颜色色块、七宝造型、11 种展开图缩略图、骰子点数和截面多边形表达实际数据，不是另一套功能图标；继续从各自数学模型生成。XYZ 参数行、颜色与透明度、浮窗、动作按钮使用共用实现。</p>
      <p>合并的是操作入口和通用控件；剪棱拓扑、折叠路径、骰子点数与投掷、液体守恒、截面和测量仍由各领域负责。旧冻结课件的动作能力保持原边界。</p>
    </section><footer>生成命令：node scripts/spatial-controls-catalog.mjs · 图标权威：SpatialActionIcon + actions.ts</footer>
  </main>);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>3D 功能与图标对照</title><style>
  :root{--paper:#fffdf8;--ink:#29251f;--line:#e8e1d5;--muted:#766f65;--moon:#feedb9}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.7 'Microsoft YaHei',sans-serif}main{max-width:1260px;margin:0 auto;padding:32px 24px}h1{font-size:30px}h2{font-size:23px;margin:0 0 12px}h3{margin:0}p{margin:8px 0 14px}section{margin:48px 0}nav{display:flex;gap:24px;flex-wrap:wrap}a{color:inherit;text-underline-offset:4px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:12px;border-bottom:1px solid var(--line);vertical-align:middle}thead{background:var(--paper);position:sticky;top:0}td:first-child{white-space:nowrap}svg{width:28px;height:28px;vertical-align:middle;flex-shrink:0}svg.small{width:18px;height:18px}.sample{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;margin:3px 8px;min-width:68px;font-size:12px}.current{background:var(--moon);border-radius:8px;padding:8px}.comparison{display:flex;align-items:center;gap:22px}.strip{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.strip .sample{min-width:100px}small{display:block;font-size:12px;color:var(--muted)}article{padding:20px 0;border-bottom:1px solid var(--line)}.muted,footer,details{color:var(--muted);font-size:13px}code{font-size:12px;overflow-wrap:anywhere}@media(max-width:700px){main{padding:20px 12px}th,td{padding:8px 4px;font-size:12px}.sample{margin:2px;min-width:50px}svg{width:24px;height:24px}.comparison{gap:8px}}@media print{thead{position:static}article,tr{break-inside:avoid}nav{display:none}}
  </style></head><body>${body}</body></html>`;
}
