type Row = { id: string; name: string; detail: string };
type Block = { id: string; style: "chips" | "picker" | "tile"; participants: Row[]; selected: string; state: string };
// The selected participant applies to every runtime screen and to the original pages.
Component({
  options: { styleIsolation: "apply-shared" },
  properties: { block: { type: Object, value: {} }, strings: { type: Object, value: {} } },
  data: { index: 0, subtitle: "" },
  observers: {
    block(block: Block) {
      const index = Math.max(0, (block.participants || []).findIndex(row => row.id === block.selected));
      this.setData({ index, subtitle: block.participants?.[index]?.detail || "" });
    },
  },
  methods: {
    choose(e: WechatMiniprogram.TouchEvent) { const id = String(e.currentTarget.dataset.id || ""); if (id && id !== (this.data.block as Block).selected) this.triggerEvent("participant", { id }); },
    pick(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
      const row = (this.data.block as Block).participants[Number(e.detail.value)];
      if (row && row.id !== (this.data.block as Block).selected) this.triggerEvent("participant", { id: row.id });
    },
    /** Account tile: choosing a child opens that child's calendar, as the original account page did. */
    open(e: WechatMiniprogram.TouchEvent) { this.triggerEvent("participant", { id: String(e.currentTarget.dataset.id || ""), open: 2 }); },
    list() {
      if ((this.data.block as Block).state === "signedOut") this.login();
      else this.triggerEvent("sheet", { kind: "participants", block: (this.data.block as Block).id });
    },
    login() { this.triggerEvent("action", { action: { type: "login" } }); },
  },
});
