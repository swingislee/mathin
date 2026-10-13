Component({
  options: { styleIsolation: "apply-shared" },
  properties: { rows: { type: Array, value: [] }, actionLabel: { type: String, value: "" } },
  methods: { select(e: WechatMiniprogram.TouchEvent) { this.triggerEvent("select", { id: String(e.currentTarget.dataset.id) }); } },
});
