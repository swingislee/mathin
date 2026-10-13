"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import type { SudokuVariantPayload } from "./courseware-contract";
import { getSudokuVariant } from "./variant";

export function SudokuRuleEditor({ payload, selected, onChange }: {
  payload: SudokuVariantPayload; selected: number | null; onChange: (payload: SudokuVariantPayload) => void;
}) {
  const t = useTranslations("teacherMicrocourses.sudokuRules");
  const { rules } = payload, n = getSudokuVariant(payload.variantId)!.size;
  const selectClass = "rounded border border-line bg-paper p-1 text-sm";
  const coordinate = selected === null ? "" : `${String.fromCharCode(65 + Math.floor(selected / n))}${selected % n + 1}`;
  return <div className="space-y-2 rounded-lg border border-line p-3 text-xs">
    <p>{t(rules.kind)}</p>
    {(rules.kind === "irregular" || rules.kind === "parity" || rules.kind === "inequality") && <p>{selected === null ? t("selectCell") : t("selected", { coordinate })}</p>}
    {rules.kind === "irregular" && selected !== null && <label className="flex items-center gap-2">{t("region")}
      <select className={selectClass} value={rules.regions[selected]} onChange={(e) => onChange({ ...payload, rules: { ...rules, regions: rules.regions.map((v, i) => i === selected ? Number(e.target.value) : v) } })}>
        {Array.from({ length: n }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
      </select>
    </label>}
    {rules.kind === "parity" && selected !== null && <select aria-label={t("parity")} className={selectClass} value={rules.cells[selected]} onChange={(e) => onChange({ ...payload, rules: { ...rules, cells: rules.cells.map((v, i) => i === selected ? Number(e.target.value) : v) } })}>
      {["any", "odd", "even"].map((label, i) => <option key={label} value={i}>{t(label)}</option>)}
    </select>}
    {rules.kind === "inequality" && selected !== null && (["right", "bottom"] as const).map((direction) => {
      const other = selected + (direction === "right" ? 1 : n);
      if (other >= n * n || (direction === "right" && selected % n === n - 1)) return null;
      const pair = rules.lessThan.find(([a, b]) => (a === selected && b === other) || (a === other && b === selected));
      return <label key={direction} className="mr-3 inline-flex items-center gap-1">{t(direction)}
        <select className={selectClass} value={!pair ? "none" : pair[0] === selected ? "less" : "greater"} onChange={(e) => {
          const lessThan = rules.lessThan.filter(([a, b]) => !((a === selected && b === other) || (a === other && b === selected)));
          if (e.target.value !== "none") lessThan.push(e.target.value === "less" ? [selected, other] : [other, selected]);
          onChange({ ...payload, rules: { ...rules, lessThan } });
        }}><option value="none">—</option><option value="less">&lt;</option><option value="greater">&gt;</option></select>
      </label>;
    })}
    {rules.kind === "skyscraper" && (["top", "bottom", "left", "right"] as const).map((side) => <div key={side} className="flex items-center gap-1">
      <span className="w-8">{t(side)}</span>{rules[side].map((v, i) => <Input key={i} aria-label={`${t(side)} ${i + 1}`} className="h-8 w-10 p-0 text-center" inputMode="numeric" maxLength={1} value={v || ""} onChange={(e) => {
        const value = Number(e.target.value);
        onChange({ ...payload, rules: { ...rules, [side]: rules[side].map((a, j) => j === i ? Number.isInteger(value) && value >= 0 && value <= n ? value : 0 : a) } });
      }} />)}
    </div>)}
  </div>;
}
