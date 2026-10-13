// The selected participant applies to every runtime screen and to the original pages.
Component({
  options: { styleIsolation: "apply-shared" },
  properties: { block: { type: Object, value: {} }, strings: { type: Object, value: {} } },
  methods: {
    choose(e: WechatMiniprogram.TouchEvent) { const id = String(e.currentTarget.dataset.id || ""); if (id && id !== (this.data.block as { selected: string }).selected) this.triggerEvent("participant", { id }); },
    login() { this.triggerEvent("action", { action: { type: "login" } }); },
  },
});
