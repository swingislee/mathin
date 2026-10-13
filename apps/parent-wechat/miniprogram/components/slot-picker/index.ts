type Slot = { id: string; label: string; selected: boolean; available?: boolean };
Component({
  properties: { rows: { type: Array, value: [] as Slot[] }, days: { type: Array, value: [] }, timeRows: { type: Array, value: [] }, weekLabel: String, labels: { type: Object, value: {} }, disabled: Boolean, mode: { type: String, value: "list" } },
  options: { styleIsolation: "apply-shared" },
  methods: { select(e: WechatMiniprogram.TouchEvent) { if (!this.data.disabled && e.currentTarget.dataset.id) this.triggerEvent("select", { id: String(e.currentTarget.dataset.id) }); } },
});
