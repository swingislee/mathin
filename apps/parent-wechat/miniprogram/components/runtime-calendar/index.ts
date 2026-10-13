import type { RuntimeDay, RuntimeItem } from "../../lib/runtime-contract";
type Block = { id: string; anchor: string; previous: string; next: string; days: RuntimeDay[]; items: RuntimeItem[] };
// One published week; choosing a day filters locally and changing week asks the host for that week.
Component({
  options: { styleIsolation: "apply-shared" },
  properties: { block: { type: Object, value: {} }, strings: { type: Object, value: {} } },
  data: { selected: "", days: [] as (RuntimeDay & { selected: boolean })[], weekdays: [] as string[], dayItems: [] as (RuntimeItem & { metaText: string })[], rangeLabel: "" },
  observers: {
    "block, strings"(block: Block, strings: Record<string, string>) {
      const days = block.days || [];
      const keep = days.some(day => day.date === this.data.selected) ? this.data.selected : "";
      const selected = keep || days.find(day => day.today)?.date || days.find(day => day.count)?.date || block.anchor || days[0]?.date || "";
      const first = days[0]?.date || "", last = days[days.length - 1]?.date || "";
      this.setData({ weekdays: String(strings.weekdays || "").split(","), rangeLabel: first ? `${first.slice(5).replace("-", ".")} – ${last.slice(5).replace("-", ".")}` : "" });
      this.render(selected);
    },
  },
  methods: {
    render(selected: string) {
      const block = this.data.block as Block;
      this.setData({ selected, days: (block.days || []).map(day => ({ ...day, selected: day.date === selected })),
        dayItems: (block.items || []).filter(item => item.date === selected).map(item => ({ ...item, metaText: item.meta.join(" · ") })) });
    },
    day(e: WechatMiniprogram.CustomEvent<{ date: string }>) { this.render(String(e.detail.date)); },
    previous() { const block = this.data.block as Block; this.triggerEvent("week", { block: block.id, anchor: block.previous }); },
    next() { const block = this.data.block as Block; this.triggerEvent("week", { block: block.id, anchor: block.next }); },
    act(e: WechatMiniprogram.TouchEvent) { const action = e.currentTarget.dataset.action; if (action) this.triggerEvent("action", { action }); },
    login() { this.triggerEvent("action", { action: { type: "login" } }); },
  },
});
