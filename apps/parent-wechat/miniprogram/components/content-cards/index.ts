Component({
  properties: { density: { type: String, value: "comfortable" }, rows: { type: Array, value: [] }, layout: { type: String, value: "list" } },
  methods: { select(e: WechatMiniprogram.TouchEvent) { this.triggerEvent("select", { id: String(e.currentTarget.dataset.id) }); } },
});
