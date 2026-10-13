"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated staff images are served by the existing image endpoint. */
import { Fragment, useContext, type ReactNode } from "react";
import { contentRichText, renderContent, type ContentData, type RichTextNode } from "../../../../contracts/participant-api/miniapp-content-render";
import { localText, type ContentDocument, type ExperienceLocale, type MiniappExperience } from "../../../../contracts/participant-api/miniapp-experience";
import { WorkbenchContext } from "./WorkbenchContext";

function nodes(value: RichTextNode[]): ReactNode { return value.map((node, index) => {
  if (node.type === "text") return <Fragment key={index}>{node.text}</Fragment>;
  const children = nodes(node.children || []);
  if (node.name === "strong") return <strong key={index}>{children}</strong>;
  if (node.name === "em") return <em key={index}>{children}</em>;
  if (node.name === "br") return <br key={index} />;
  return <p key={index} className="mb-2 last:mb-0">{children}</p>;
}); }
export const richTextPreview = (text: string) => nodes(contentRichText(text));
const imageUrl = (path: string) => `/api/v1/participant/settings/image?preview=1&path=${encodeURIComponent(path)}`;

export const exampleReportData: ContentData = { report: {
  context: [{ id: "participant", title: { zh: "参与人", en: "Participant" }, body: { zh: "示例参与人", en: "Example participant" } }, { id: "topic", title: { zh: "诊断主题", en: "Topic" }, body: { zh: "示例主题", en: "Example topic" } }],
  score: 8, totalScore: 10, assessmentBand: "发展中",
  scoreBreakdown: [{ label: { zh: "本次得分", en: "Recorded score" }, value: 8, maximum: 10 }],
  dimensionScores: [{ label: { zh: "理解", en: "Understanding" }, value: 8, maximum: 10 }, { label: { zh: "表达", en: "Expression" }, value: 6, maximum: 10 }, { label: { zh: "推理", en: "Reasoning" }, value: 7, maximum: 10 }, { label: { zh: "迁移", en: "Transfer" }, value: 5, maximum: 10 }],
  scoreHistory: [{ label: "09/01", value: 5, maximum: 10 }, { label: "09/15", value: 6, maximum: 10 }, { label: "10/01", value: 8, maximum: 10 }],
  summary: "能说明自己的思考过程，在需要转换表示方式时仍需要提示。这里是用于检查排版的示例观察。",
  strengths: "愿意尝试不同方法，并能比较两种解法。", focusAreas: "继续练习把图形关系用自己的语言表达出来。",
  recommendation: "下一次可以从一个具体例子开始，先画图、再说明理由，最后比较不同方法。",
  dimensions: { columns: ["任务", "表现", "依据"], rows: [["寻找规律", "能独立完成", "给出了连续两个正确例子"], ["图形表达", "提示后完成", "根据提示补充了关键关系"]] },
  evidence: [{ id: "one", title: "一次思考过程", body: "先画出几个例子，再发现重复出现的部分；这是示例证据，不代表真实测评记录。" }],
} };

export function ExperiencePreview({ document, experience, locale, selectedId, onSelect, data = document.purpose === "report" ? exampleReportData : document.purpose === "service" ? { service: experience.services.find(s => s.detailPageId === document.id) } : {} }: {
  document: ContentDocument; experience: MiniappExperience; locale: ExperienceLocale; selectedId?: string; onSelect?: (id: string) => void; data?: ContentData;
}) {
  const blocks = renderContent(document, data, locale), workspace = useContext(WorkbenchContext);
  return <div className="min-w-0 bg-paper text-ink">
    <div className="border-b border-line px-5 py-3 text-sm font-medium">{localText(document.title, locale)}</div>
    {document.purpose === "report" && <p className="px-5 pt-3 text-xs text-muted">{locale === "zh" ? "以下用示例数据预览排版，发布时使用真实记录。" : "Sample data previews the layout. Published reports use actual records."}</p>}
    <div className="space-y-5 px-5 py-5">{blocks.map(block => <div key={block.id} onClick={() => onSelect?.(block.id)} className={(onSelect ? "cursor-pointer " : "") + (selectedId === block.id ? "outline-2 outline-offset-4 outline-crater " : "") + (document.layout === "sections" && block.kind !== "divider" ? "border-b border-line pb-5 " : "")}>
      {block.title && <div className={block.kind === "heading" ? "mb-2 text-xl font-semibold" : "mb-2 text-base font-medium"}>{block.title}</div>}
      {(block.kind === "paragraph" || block.kind === "callout" || block.kind === "quote") && <div className={"text-sm leading-7 " + (block.kind === "callout" ? "border-l-4 border-crater bg-moon/25 px-4 py-3" : block.kind === "quote" ? "border-l-2 border-line pl-4 italic" : "")}>{nodes(block.nodes)}</div>}
      {block.kind === "image" && <figure>{block.image ? <img alt={block.caption} src={imageUrl(block.image)} className="max-h-80 w-full object-contain" /> : <div className="flex h-32 items-center justify-center bg-line/30 text-xs text-muted">{locale === "zh" ? "选择或上传图片" : "Choose an image"}</div>}{block.caption && <figcaption className="mt-2 text-xs text-muted">{block.caption}</figcaption>}</figure>}
      {["bullets", "steps", "facts", "faq", "evidence"].includes(block.kind) && <div className="divide-y divide-line">{block.items.map((item, index) => <div key={item.id} className="py-3 first:pt-0 last:pb-0">
        <div className={block.kind === "facts" ? "grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3" : "space-y-1"}>
          <div className="text-sm font-medium">{block.kind === "steps" && <span className="mr-2 text-muted">{index + 1}.</span>}{block.kind === "bullets" && <span className="mr-2">•</span>}{item.title}</div>
          <div className="text-sm leading-6">{nodes(item.nodes)}</div>
        </div>{item.image && <img alt={item.title} src={imageUrl(item.image)} className="mt-3 max-h-48 w-full object-contain" />}
      </div>)}</div>}
      {block.kind === "table" && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{block.columns.map((c, i) => <th key={i} className="border-b border-line p-2">{c}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={index}>{row.map((cell, i) => <td key={i} className="border-b border-line p-2 align-top">{cell}</td>)}</tr>)}</tbody></table></div>}
      {block.kind === "action" && <button type="button" className={block.appearance === "primary" ? "w-full rounded-lg bg-ink px-4 py-3 text-sm text-paper" : block.appearance === "link" ? "text-sm underline" : "w-full rounded-lg border border-line px-4 py-3 text-sm"}>{block.text}</button>}
      {block.kind === "divider" && <hr className="border-line" />}
      {block.kind === "chart" && block.chart && <figure className="space-y-3">
        {block.chartImage && <img src={block.chartImage} alt={block.title} className="mx-auto w-full max-w-72" />}
        <div className="space-y-3">{(block.appearance === "donut" ? block.chart.points.slice(0, 1) : block.chart.points).map((point, i) => <div key={i}><div className="flex justify-between gap-3 text-xs"><span className="min-w-0 break-words">{point.label}</span><span className="shrink-0 tabular-nums">{point.valueLabel}</span></div>{block.appearance === "bars" && <div className="mt-2 h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-leaf-deep" style={{ width: `${point.percent}%` }} /></div>}</div>)}</div>
        {block.text && <figcaption className="text-xs leading-5 text-muted">{block.text}</figcaption>}
      </figure>}
      {(block.kind === "metric" || block.kind === "scale") && <div><div className="text-3xl font-semibold">{block.value}<span className="ml-2 text-sm font-normal">{block.caption}</span></div>{block.labels.length > 0 && <div className="mt-3 flex gap-1">{block.labels.map(label => <span key={label} className="flex-1 border-b-4 border-leaf pb-2 text-center text-xs">{label}</span>)}</div>}<div className="mt-3 text-sm text-muted">{block.text}</div></div>}
      {block.kind === "services" && <div className="divide-y divide-line">{experience.services.filter(s => s.enabled && (!block.ids.length || block.ids.includes(s.id))).slice(0, block.limit).map(service => <div key={service.id} className="flex items-center gap-3 py-3"><div className="flex-1"><div className="text-sm font-medium">{localText(service.name, locale)}</div><div className="mt-1 text-xs leading-5 text-muted">{localText(service.summary, locale)}</div></div><span>›</span></div>)}</div>}
      {block.kind === "activities" && <div className="divide-y divide-line">{(workspace?.activities || []).filter(a => !block.ids.length || block.ids.includes(a.id)).slice(0, block.limit).map(a => <div key={a.id} className="flex items-center gap-3 py-4"><span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-moon text-crater">◇</span><span className="min-w-0 flex-1 text-sm">{a.title}</span><span>›</span></div>)}{!workspace?.activities.length && <p className="py-4 text-sm text-muted">{block.text}</p>}</div>}
      {block.kind === "contacts" && <div className="divide-y divide-line">{(workspace?.config.contacts || []).filter(c => c.visible && (!block.ids.length || block.ids.includes(c.id))).slice(0, block.limit).map(c => <div key={c.id} className="space-y-1 py-3"><strong className="text-sm">{localText(c.name, locale)}</strong><p className="text-xs text-muted">{localText(c.service, locale)}</p><p className="text-xs">{c.phone}</p></div>)}{!workspace?.config.contacts?.some(c => c.visible) && <p className="py-4 text-sm text-muted">{block.text}</p>}</div>}
    </div>)}</div>
  </div>;
}
