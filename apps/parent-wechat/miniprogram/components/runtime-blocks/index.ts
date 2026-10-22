type View = { id: string; type: string; open?: boolean; blocks?: View[]; tabs?: unknown[] };
// Renders published runtime blocks. Every interaction is reported upward; the host page runs it.
Component({
  options: { styleIsolation: "apply-shared" },
  properties: {
    blocks: { type: Array, value: [] }, strings: { type: Object, value: {} }, locale: { type: String, value: "zh" }, lifted: Boolean,
    /** Blocks inside a card section share that card instead of drawing their own. */
    inCard: Boolean, layout: { type: String, value: "column" },
    /** The screen these blocks belong to, for commands sent from forms. */
    screen: { type: String, value: "" },
    screenParams: { type: Object, value: {} },
  },
  data: { tabIndex: {} as Record<string, number>, opened: {} as Record<string, boolean> },
  observers: {
    blocks(rows: View[]) {
      // Tabs start on the first tab and groups start as published; choices made on this page are kept when the screen refreshes.
      const tabIndex = { ...this.data.tabIndex }, opened = { ...this.data.opened };
      for (const row of rows || []) {
        if (row.type === "tabs" && tabIndex[row.id] === undefined) tabIndex[row.id] = 0;
        if (row.type === "collapse" && opened[row.id] === undefined) opened[row.id] = row.open === true;
      }
      if (Object.keys(tabIndex).length !== Object.keys(this.data.tabIndex).length || Object.keys(opened).length !== Object.keys(this.data.opened).length)
        this.setData({ tabIndex, opened });
    },
  },
  methods: {
    act(e: WechatMiniprogram.TouchEvent) { const action = e.currentTarget.dataset.action; if (action) this.triggerEvent("action", { action }); },
    facet(e: WechatMiniprogram.TouchEvent) { this.triggerEvent("facet", { block: String(e.currentTarget.dataset.block), facet: String(e.currentTarget.dataset.facet) }); },
    clearFilters(e: WechatMiniprogram.TouchEvent) { this.triggerEvent("facet", { block: String(e.currentTarget.dataset.block), facet: "", clear: true }); },
    account(e: WechatMiniprogram.TouchEvent) {
      if (e.currentTarget.dataset.signed) this.triggerEvent("account", { name: String(e.currentTarget.dataset.name || "") });
      else this.triggerEvent("action", { action: { type: "login" } });
    },
    tab(e: WechatMiniprogram.TouchEvent) { this.setData({ [`tabIndex.${e.currentTarget.dataset.block}`]: Number(e.currentTarget.dataset.index) }); },
    toggle(e: WechatMiniprogram.TouchEvent) { const id = String(e.currentTarget.dataset.block); this.setData({ [`opened.${id}`]: !this.data.opened[id] }); },
    login() { this.triggerEvent("action", { action: { type: "login" } }); },
    preview(e: WechatMiniprogram.TouchEvent) { const image = String(e.currentTarget.dataset.image || ""); if (image) wx.previewImage({ urls: [image] }); },
    forward(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("action", e.detail); },
    forwardFacet(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("facet", e.detail); },
    forwardWeek(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("week", e.detail); },
    forwardParticipant(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("participant", e.detail); },
    forwardAccount(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("account", e.detail); },
    forwardSheet(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("sheet", e.detail); },
    forwardSearch(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("search", e.detail); },
    forwardMore(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("more", e.detail); },
    forwardRefresh(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("refresh", e.detail); },
    forwardEffects(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("effects", e.detail); },
  },
});
