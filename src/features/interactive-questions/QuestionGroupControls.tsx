"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const ALL_QUESTION_GROUPS = "__all__";
export const UNGROUPED_QUESTIONS = "__ungrouped__";
export function QuestionGroupControls({ groups, selected, onSelect, onAdd, onRename, onMove, disabled = false, readOnly = false }: {
  groups: { id: string; name: string; count: number }[]; selected: string;
  onSelect: (id: string) => void; onAdd: (name: string) => void | boolean | Promise<boolean>; onRename: (id: string, name: string) => void | boolean | Promise<boolean>;
  onMove: (id: string, direction: -1 | 1) => void; disabled?: boolean; readOnly?: boolean;
}) {
  const en = useLocale() === "en";
  const t = (zh: string, english: string) => en ? english : zh;
  const [draftName, setDraftName] = useState<string | null>(null);
  const active = groups.find(group => group.id === selected);
  const name = draftName ?? active?.name ?? "";
  const valid = Boolean(name.trim()) && !groups.some(group => group.name === name.trim() && group.id !== active?.id);
  return <div className="flex flex-wrap items-center gap-2" data-question-group-controls>
    <Select value={selected} onValueChange={id => { setDraftName(null); onSelect(id); }} disabled={disabled}>
      <SelectTrigger className="w-44" aria-label={t("题目分组", "Question group")}><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value={ALL_QUESTION_GROUPS}>{t("全部分组", "All groups")}</SelectItem><SelectItem value={UNGROUPED_QUESTIONS}>{t("未分组", "Ungrouped")}</SelectItem>
        {groups.map(group => <SelectItem key={group.id} value={group.id}>{group.name} ({group.count})</SelectItem>)}
      </SelectContent>
    </Select>
    {!readOnly && <><Input className="w-40" aria-label={t("分组名称", "Group name")} placeholder={t("例如：基础过关", "e.g. Foundations")} maxLength={60} value={name} disabled={disabled} onChange={e => setDraftName(e.target.value)} />
    <Button size="sm" variant="secondary" disabled={disabled || !valid || groups.some(g => g.name === name.trim())} onClick={async () => { if (await onAdd(name.trim()) !== false) setDraftName(null); }}>{t("新建分组", "New group")}</Button></>}
    {active && !readOnly && <>
      <Button size="sm" variant="ghost" disabled={disabled || !valid || active.name === name.trim()} onClick={async () => { if (await onRename(active.id, name.trim()) !== false) setDraftName(null); }}>{t("重命名组", "Rename group")}</Button>
      <Button size="sm" variant="ghost" aria-label={t("分组上移", "Move group up")} disabled={disabled || groups[0]?.id === active.id} onClick={() => onMove(active.id, -1)}>↑</Button>
      <Button size="sm" variant="ghost" aria-label={t("分组下移", "Move group down")} disabled={disabled || groups.at(-1)?.id === active.id} onClick={() => onMove(active.id, 1)}>↓</Button>
    </>}
  </div>;
}
