"use client";
import { defaultReportTemplates, type ReportTemplates } from "../../../../contracts/participant-api/report-template";
import { LocalizedField, MoveControls, moveItem } from "./fields";
export function ReportTemplatesEditor({ value, en, onChange }: { value?: ReportTemplates; en: boolean; onChange: (value: ReportTemplates) => void }) {
  const templates = value || defaultReportTemplates();
  return <div className="max-w-3xl space-y-8"><p className="text-sm text-muted">{en ? "Choose headings, order and visible sections for newly generated reports. Existing reports keep their original template. Section content comes from recorded results." : "设置新生成报告的栏目名称、顺序与显隐。已有报告保留原模板，栏目正文来自已录入的结果。"}</p>
    {(["assessment", "feedback"] as const).map(kind => <section key={kind} className="space-y-4"><h3 className="font-medium">{kind === "assessment" ? (en ? "Assessment reports" : "诊断报告") : (en ? "Session feedback" : "课次反馈")}</h3>{templates[kind].map((s, index) => <div key={s.source} className="space-y-2 border-b border-line pb-4">
      <MoveControls en={en} index={index} length={templates[kind].length} move={offset => onChange({ ...templates, [kind]: moveItem(templates[kind], index, offset) })}>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.visible} onChange={e => onChange({ ...templates, [kind]: templates[kind].map((v, i) => i === index ? { ...v, visible: e.target.checked } : v) })} />{en ? "Visible" : "展示"}</label>
        <span className="text-xs text-muted">{defaultReportTemplates()[kind].find(v => v.source === s.source)!.label[en ? "en" : "zh"]}</span>
      </MoveControls>
      <LocalizedField label={en ? "Section heading" : "栏目标题"} value={s.label} max={100} onChange={label => onChange({ ...templates, [kind]: templates[kind].map((v, i) => i === index ? { ...v, label } : v) })} />
    </div>)}</section>)}
  </div>;
}
