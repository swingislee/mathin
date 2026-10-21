"use client";
import { Input } from "@/components/ui/input";
import { rewardRarities, type RewardDrawPool } from "./contract";

export function DrawMechanismEditor({ pool, onChange, locale }: { pool: RewardDrawPool; onChange: (value: RewardDrawPool) => void; locale: "zh" | "en" }) {
  const L = (zh: string, en: string) => locale === "zh" ? zh : en;
  const m = pool.mechanism ?? { mode: "weighted" as const };
  return <section className="space-y-3 rounded-lg border border-line p-4">
    <label className="block text-sm">{L("抽取方式", "Draw mechanism")}<select className="ml-3 rounded-md border border-line bg-paper p-2" value={m.mode} onChange={event => onChange({ ...pool,
      pity_after: 0, mechanism: event.target.value === "rarity" ? { mode: "rarity", rates: { R: 0, SR: 0, SSR: 0, SP: 0, UR: 0 }, pities: [] } : { mode: "weighted" },
      entries: pool.entries.map(e => ({ ...e, rarity: e.rarity || "R" })) })}>
      <option value="weighted">{L("奖品权重", "Prize weights")}</option><option value="rarity">R / SR / SSR / SP / UR</option></select></label>
    {m.mode === "rarity" && <>
      <p className="text-sm text-muted-foreground">{L("先按档位概率抽取，再按该档位内奖品的权重抽取。各档概率合计须为 100%；大于 0 的档位至少配置一件奖品。", "Choose a rarity first, then a prize by weight within it. Rates must total 100%; each nonzero rarity needs a prize.")}</p>
      <div className="grid grid-cols-5 gap-3">{rewardRarities.map(r => <label key={r} className="text-sm">{r} %<Input type="number" min={0} max={100} step={0.0001} value={m.rates[r] / 10000} onChange={event => onChange({ ...pool, mechanism: { ...m, rates: { ...m.rates, [r]: Math.round(Number(event.target.value) * 10000) } } })} /></label>)}</div>
      <p className="text-sm">{L("当前合计", "Total")}: {Object.values(m.rates).reduce((a, b) => a + b, 0) / 10000}%</p>
      <h3 className="font-medium">{L("分档保底", "Rarity guarantees")}</h3>
      {rewardRarities.filter(r => r !== "R").map(r => { const existing = m.pities.find(p => p.minRarity === r); return <div key={r} className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!existing} onChange={event => onChange({ ...pool, mechanism: { ...m, pities: event.target.checked ? [...m.pities, { minRarity: r, after: 1 }] : m.pities.filter(p => p.minRarity !== r) } })} />{r}{L(" 或更高档", " or higher")}</label>
        {existing && <label className="flex items-center gap-2">{L("连续未获得，最多", "Guaranteed within")}<Input className="w-28" type="number" min={1} max={1000000} value={existing.after} onChange={event => onChange({ ...pool, mechanism: { ...m, pities: m.pities.map(p => p.minRarity === r ? { ...p, after: Number(event.target.value) } : p) } })} />{L("次内必得", "draws")}</label>}
      </div>; })}
      <p className="text-sm text-muted-foreground">{L("命中对应档位或更高档后，该计数归零；同时触发多档保底时采用最高档，保底档位以上按基础概率的相对比例抽取。稀有度计数从启用此模式后的抽取开始，按孩子和奖池持续保留。", "A win resets all guarantees at or below that rarity. Simultaneous guarantees use the highest threshold and the relative base rates above it. Rarity counters start with draws in this mode and persist per child and pool.")}</p>
    </>}
  </section>;
}
