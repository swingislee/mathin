"use client";
import { newId } from "@/lib/uuid";
import { Button } from "@/components/ui/button";
import type { FormQuestion, QuestionAnswers } from "../../../../contracts/participant-api/form-questions";
import { questionAnswerText } from "../../../../contracts/participant-api/form-questions";

const input = "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm";
export function QuestionsEditor({ fields, onChange, en = false, disabled = false }: {
  fields: FormQuestion[]; onChange: (fields: FormQuestion[]) => void; en?: boolean; disabled?: boolean;
}) {
  const t = (zh: string, english: string) => en ? english : zh;
  function patch(id: string, value: Partial<FormQuestion>) { onChange(fields.map(f => f.id === id ? { ...f, ...value } : f)); }
  function move(index: number, offset: number) { const next = [...fields]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; onChange(next); }
  return <fieldset disabled={disabled} className="space-y-4"><div><h3 className="text-sm font-medium">{t("附加问题", "Additional questions")}</h3><p className="mt-1 text-xs text-muted">{t("回答与本次表单一起保存。修改问题或选项后，历史记录保留原名称与回答。", "Answers are saved with this form. Previous submissions keep their original questions and option labels.")}</p></div>
    {fields.map((field, index) => <div key={field.id} className="space-y-3 rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2"><span className="text-sm">{index + 1}</span><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={!index} onClick={() => move(index, -1)}>↑</Button><Button size="sm" variant="ghost" disabled={index === fields.length - 1} onClick={() => move(index, 1)}>↓</Button><Button size="sm" variant="ghost" onClick={() => onChange(fields.filter(f => f.id !== field.id))}>{t("移除", "Remove")}</Button></div></div>
      <label className="grid gap-1 text-sm">{t("问题", "Question")}<input className={input} value={field.label.zh} maxLength={100} onChange={e => patch(field.id, { label: { ...field.label, zh: e.target.value } })} /></label>
      <input className={input} aria-label="English question" placeholder={t("英文问题（选填）", "English question (optional)")} value={field.label.en} maxLength={160} onChange={e => patch(field.id, { label: { ...field.label, en: e.target.value } })} />
      <label className="grid gap-1 text-sm">{t("填写方式", "Answer type")}<select className={input} value={field.type} onChange={e => {
        const type = e.target.value as FormQuestion["type"];
        patch(field.id, { type, options: type === "select" || type === "multiselect" ? field.options || [{ id: "o_" + newId().replaceAll("-", ""), label: { zh: t("选项一", "Option 1"), en: "" } }] : undefined });
      }}>{([ ["text", "简短文字", "Short text"], ["textarea", "多行文字", "Long text"], ["phone", "联系电话", "Phone"], ["select", "单选", "Single choice"], ["multiselect", "多选", "Multiple choice"] ] as const).map(([id, zh, english]) => <option key={id} value={id}>{t(zh, english)}</option>)}</select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={field.required} onChange={e => patch(field.id, { required: e.target.checked })} />{t("必须填写", "Required")}</label>
      {field.options && <div className="space-y-2">{field.options.map((option, optionIndex) => <div key={option.id} className="flex items-start gap-2"><div className="min-w-0 flex-1 space-y-1"><input className={input} aria-label={`${t("选项", "Option")} ${optionIndex + 1}`} maxLength={100} value={option.label.zh} onChange={e => patch(field.id, { options: field.options!.map(o => o.id === option.id ? { ...o, label: { ...o.label, zh: e.target.value } } : o) })} /><input className={input} aria-label={`English option ${optionIndex + 1}`} placeholder="English" maxLength={160} value={option.label.en} onChange={e => patch(field.id, { options: field.options!.map(o => o.id === option.id ? { ...o, label: { ...o.label, en: e.target.value } } : o) })} /></div><Button size="sm" variant="ghost" disabled={field.options!.length === 1} onClick={() => patch(field.id, { options: field.options!.filter(o => o.id !== option.id) })}>×</Button></div>)}<Button size="sm" variant="secondary" disabled={field.options.length >= 20} onClick={() => patch(field.id, { options: [...field.options!, { id: "o_" + newId().replaceAll("-", ""), label: { zh: "", en: "" } }] })}>{t("添加选项", "Add option")}</Button></div>}
    </div>)}
    <Button size="sm" variant="secondary" disabled={fields.length >= 20} onClick={() => onChange([...fields, { id: "q_" + newId().replaceAll("-", ""), type: "text", label: { zh: t("新问题", "New question"), en: "" }, required: false }])}>{t("添加问题", "Add question")}</Button>
  </fieldset>;
}
export function QuestionAnswersView({ fields, answers, en = false }: { fields: FormQuestion[]; answers: QuestionAnswers; en?: boolean }) {
  return fields.length ? <dl className="space-y-2 text-sm">{fields.map(field => <div key={field.id}><dt className="text-xs text-muted">{field.label[en ? "en" : "zh"] || field.label.zh}</dt><dd className="whitespace-pre-wrap break-words">{questionAnswerText(field, answers[field.id], en ? "en" : "zh") || (en ? "Not provided" : "未填写")}</dd></div>)}</dl> : null;
}
