import { currentApp, onAppChange, runtimeImage } from "../lib/runtime";
import { runtimeTabRoutes, type RuntimeTab } from "../lib/runtime-contract";

type Row = RuntimeTab & { iconUrl: string; activeUrl: string };
const rows = (): Row[] => currentApp().tabs.map(tab => ({ ...tab, iconUrl: runtimeImage(tab.icon), activeUrl: runtimeImage(tab.activeIcon || tab.icon) }));
const subscriptions = new WeakMap<object, () => void>();
function selectedSlot() {
  const route = "/" + (getCurrentPages().slice(-1)[0]?.route || "pages/discover/index");
  return Number(Object.keys(runtimeTabRoutes).find(slot => runtimeTabRoutes[Number(slot) as keyof typeof runtimeTabRoutes] === route)) || 1;
}

// The five tab routes are fixed in app.json; Mathin decides which slots appear, their labels and icons.
Component({
  data: { tabs: rows(), selected: selectedSlot(), hidden: false, presentation: currentApp().presentation || "classic" },
  lifetimes: {
    attached() { this.sync(); subscriptions.set(this, onAppChange(() => this.sync())); },
    detached() { subscriptions.get(this)?.(); subscriptions.delete(this); },
  },
  methods: {
    sync() {
      const next = { tabs: rows(), selected: selectedSlot(), presentation: currentApp().presentation || "classic" };
      if (JSON.stringify(next.tabs) !== JSON.stringify(this.data.tabs) || next.selected !== this.data.selected || next.presentation !== this.data.presentation) this.setData(next);
    },
    open(e: WechatMiniprogram.TouchEvent) {
      const slot = Number(e.currentTarget.dataset.slot) as keyof typeof runtimeTabRoutes;
      if (runtimeTabRoutes[slot] && slot !== this.data.selected) wx.switchTab({ url: runtimeTabRoutes[slot] });
    },
  },
});
