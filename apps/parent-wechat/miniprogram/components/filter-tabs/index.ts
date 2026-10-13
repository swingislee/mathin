type Option = { id: string; label: string };
Component({ properties: { options: { type: Array, value: [] as Option[] }, value: String, disabled: Boolean }, methods: { select(e: WechatMiniprogram.TouchEvent) { const value = String(e.currentTarget.dataset.value || ""); if (!this.data.disabled && this.data.options.some(o => o.id === value)) this.triggerEvent("change", { value }); } } });
