import type { RuntimeItem } from "../../lib/runtime-contract";
// A data list with server-applied filters; items carry their own action.
Component({
  options: { styleIsolation: "apply-shared" },
  properties: { block: { type: Object, value: {} }, strings: { type: Object, value: {} } },
  data: { rows: [] as (RuntimeItem & { metaText: string })[] },
  observers: { block(block: { items?: RuntimeItem[] }) { this.setData({ rows: (block.items || []).map(row => ({ ...row, metaText: row.meta.join(" · ") })) }); } },
  methods: {
    act(e: WechatMiniprogram.TouchEvent) { const action = e.currentTarget.dataset.action; if (action) this.triggerEvent("action", { action }); },
    login() { this.triggerEvent("action", { action: { type: "login" } }); },
    facet(e: WechatMiniprogram.TouchEvent) { this.triggerEvent("facet", { block: (this.data.block as { id: string }).id, facet: String(e.currentTarget.dataset.facet) }); },
  },
});
