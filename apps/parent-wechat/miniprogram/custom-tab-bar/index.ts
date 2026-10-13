import { currentApp, onAppChange, runtimeImage } from "../lib/runtime";
import { runtimeTabRoutes, type RuntimeTab } from "../lib/runtime-contract";

type Row = RuntimeTab & { iconUrl: string; activeUrl: string };
const rows = (): Row[] => currentApp().tabs.map(tab => ({ ...tab, iconUrl: runtimeImage(tab.icon), activeUrl: runtimeImage(tab.activeIcon || tab.icon) }));
const subscriptions = new WeakMap<object, () => void>();

// The five tab routes are fixed in app.json; Mathin decides which slots appear, their labels and icons.
Component({
  data: { tabs: rows(), selected: 0, hidden: false },
  lifetimes: {
    attached() { this.setData({ tabs: rows() }); subscriptions.set(this, onAppChange(() => this.setData({ tabs: rows() }))); },
    detached() { subscriptions.get(this)?.(); subscriptions.delete(this); },
  },
  methods: {
    open(e: WechatMiniprogram.TouchEvent) {
      const slot = Number(e.currentTarget.dataset.slot) as keyof typeof runtimeTabRoutes;
      if (runtimeTabRoutes[slot] && slot !== this.data.selected) wx.switchTab({ url: runtimeTabRoutes[slot] });
    },
  },
});
