"use client";
import { miniappText, type MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";
import { LocalizedField, MoveControls, moveItem, settingsField } from "./fields";

type Stages = MiniappSettings["stages"];
export type StageFocus = { kind: "group" | "stage"; id: string };
/** Stage groups and labels shared by filters, contacts and participant details. With `focus`, only the selected group or stage is edited. */
export function StagesEditor({ value, locale, onChange, focus }: { value: Stages; locale: "zh" | "en"; onChange: (value: Stages) => void; focus?: StageFocus }) {
  const en = locale === "en";
  const setStage = (gi: number, si: number, change: Partial<Stages[number]["stages"][number]>) =>
    onChange(value.map((g, i) => i === gi ? { ...g, stages: g.stages.map((s, j) => j === si ? { ...s, ...change } : s) } : g));
  const showGroup = (id: string) => !focus || (focus.kind === "group" && focus.id === id);
  const showStage = (id: string) => !focus || (focus.kind === "stage" && focus.id === id);
  return <div className="max-w-4xl space-y-6">{value.map((group, gi) => (!focus || showGroup(group.id) || group.stages.some(stage => showStage(stage.id))) && <section key={group.id} className={focus ? "space-y-3" : "space-y-3 border-b border-line pb-5"}>
    {showGroup(group.id) && <><MoveControls en={en} index={gi} length={value.length} move={offset => onChange(moveItem(value, gi, offset))} />
    <LocalizedField label={en ? "Group name" : "阶段分组"} value={group.label} max={60} onChange={label => onChange(value.map((g, i) => i === gi ? { ...g, label } : g))} /></>}
    {group.stages.map((stage, si) => showStage(stage.id) && <div key={stage.id} className={focus ? "space-y-2" : "space-y-2 border-t border-line pt-3"}><MoveControls en={en} index={si} length={group.stages.length} move={offset => onChange(value.map((g, i) => i === gi ? { ...g, stages: moveItem(g.stages, si, offset) } : g))}>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={stage.visible} onChange={e => setStage(gi, si, { visible: e.target.checked })} />{en ? "Available in new selections" : "新选择中可见"}</label></MoveControls>
      <LocalizedField label={stage.stageNumber < 1 ? `K${stage.stageNumber + 3}` : `${en ? "Grade" : "年级"} ${stage.stageNumber}`} value={stage.label} max={60} onChange={label => setStage(gi, si, { label })} />
      <select className={settingsField + " max-w-xs"} aria-label={en ? "Stage group" : "所属阶段分组"} value={group.id} onChange={e => onChange(value.map(g => g.id === group.id ? { ...g, stages: g.stages.filter(s => s.id !== stage.id) } : g.id === e.target.value ? { ...g, stages: [...g.stages, stage] } : g))}>{value.map(g => <option key={g.id} value={g.id}>{miniappText(g.label, locale)}</option>)}</select>
    </div>)}</section>)}</div>;
}
