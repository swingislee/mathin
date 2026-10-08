import { activityCatalog } from "../../lib/api";
import { activityCopy, activityCard } from "../../lib/activity-catalog";
import { pageData, syncPage, errorText, currentLocale } from "../../lib/page";

Page({
  data: { ...pageData("discover"), t: activityCopy.zh, id: "", offer: null as ReturnType<typeof activityCard> | null },
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || "" }); },
  onShow() { syncPage(this, "discover"); this.setData({ t: activityCopy[currentLocale()] }); void this.load(); },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: "", offer: null });
    try {
      const row = (await activityCatalog()).find(o => o.id === this.data.id && o.kind === "activity");
      if (!row) { this.setData({ error: this.data.t.closed }); return; }
      this.setData({ offer: activityCard(row, currentLocale()) });
    } catch (error) { this.setData({ error: errorText(error) }); }
    finally { this.setData({ loading: false }); }
  },
  choose() { if (this.data.offer) wx.navigateTo({ url: "/pages/activity-signup/index?id=" + encodeURIComponent(this.data.id) }); },
  applications() { wx.navigateTo({ url: "/pages/activity-requests/index" }); },
  service() { wx.navigateTo({ url: "/pages/service/index" }); },
});
