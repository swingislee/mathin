// Renders published runtime blocks. Every interaction is reported upward; the host page runs it.
Component({
  options: { styleIsolation: "apply-shared" },
  properties: {
    blocks: { type: Array, value: [] }, strings: { type: Object, value: {} }, locale: { type: String, value: "zh" }, lifted: Boolean,
    /** Blocks inside a card section share that card instead of drawing their own. */
    inCard: Boolean, layout: { type: String, value: "column" },
  },
  methods: {
    act(e: WechatMiniprogram.TouchEvent) { const action = e.currentTarget.dataset.action; if (action) this.triggerEvent("action", { action }); },
    facet(e: WechatMiniprogram.TouchEvent) { this.triggerEvent("facet", { block: String(e.currentTarget.dataset.block), facet: String(e.currentTarget.dataset.facet) }); },
    clearFilters(e: WechatMiniprogram.TouchEvent) { this.triggerEvent("facet", { block: String(e.currentTarget.dataset.block), facet: "", clear: true }); },
    account(e: WechatMiniprogram.TouchEvent) {
      if (e.currentTarget.dataset.signed) this.triggerEvent("account", { name: String(e.currentTarget.dataset.name || "") });
      else this.triggerEvent("action", { action: { type: "login" } });
    },
    forward(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("action", e.detail); },
    forwardFacet(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("facet", e.detail); },
    forwardWeek(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("week", e.detail); },
    forwardParticipant(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("participant", e.detail); },
    forwardAccount(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("account", e.detail); },
    forwardSheet(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("sheet", e.detail); },
  },
});
