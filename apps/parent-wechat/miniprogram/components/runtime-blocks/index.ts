// Renders published runtime blocks. Every interaction is reported upward; the host page runs it.
Component({
  options: { styleIsolation: "apply-shared" },
  properties: { blocks: { type: Array, value: [] }, strings: { type: Object, value: {} }, locale: { type: String, value: "zh" }, lifted: Boolean },
  data: { loginAction: { type: "login" } },
  methods: {
    act(e: WechatMiniprogram.TouchEvent) { const action = e.currentTarget.dataset.action; if (action) this.triggerEvent("action", { action }); },
    forward(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("action", e.detail); },
    forwardFacet(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("facet", e.detail); },
    forwardWeek(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("week", e.detail); },
    forwardParticipant(e: WechatMiniprogram.CustomEvent) { this.triggerEvent("participant", e.detail); },
  },
});
