import type { RuntimeFacet, RuntimeItem } from "../../lib/runtime-contract";
type Block = { id: string; items?: RuntimeItem[]; facets?: RuntimeFacet[]; next?: string };
// A data list with server-applied filters; items carry their own action.
Component({
  options: { styleIsolation: "apply-shared" },
  properties: { block: { type: Object, value: {} }, strings: { type: Object, value: {} } },
  data: { rows: [] as (RuntimeItem & { metaText: string })[], choices: [] as RuntimeFacet[], search: null as RuntimeFacet | null, query: "" },
  observers: {
    block(block: Block) {
      const facets = block.facets || [], search = facets.find(row => row.kind === "search") || null;
      this.setData({ rows: (block.items || []).map(row => ({ ...row, metaText: row.meta.join(" · ") })), choices: facets.filter(row => row.kind !== "search"), search, query: search?.value || "" });
    },
  },
  methods: {
    act(e: WechatMiniprogram.TouchEvent) { const action = e.currentTarget.dataset.action; if (action) this.triggerEvent("action", { action }); },
    login() { this.triggerEvent("action", { action: { type: "login" } }); },
    facet(e: WechatMiniprogram.TouchEvent) { this.triggerEvent("facet", { block: (this.data.block as Block).id, facet: String(e.currentTarget.dataset.facet) }); },
    type(e: WechatMiniprogram.Input) { this.setData({ query: e.detail.value }); },
    find() { if (this.data.search) this.triggerEvent("search", { block: (this.data.block as Block).id, facet: this.data.search.id, value: this.data.query.trim() }); },
    clearSearch() { this.setData({ query: "" }); this.find(); },
    more() { const block = this.data.block as Block; if (block.next) this.triggerEvent("more", { block: block.id, cursor: block.next }); },
    preview(e: WechatMiniprogram.TouchEvent) {
      const urls = (e.currentTarget.dataset.images as string[]) || [], current = String(e.currentTarget.dataset.current || "");
      if (urls.length) wx.previewImage({ urls, current: current || urls[0] });
    },
  },
});
