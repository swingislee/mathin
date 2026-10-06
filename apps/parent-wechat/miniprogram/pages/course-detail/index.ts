import { courseCatalog } from "../../lib/api";
import { courseCopy, courseCard } from "../../lib/course-catalog";
import { pageData, syncPage, errorText, currentLocale } from "../../lib/page";

Page({
  data: { ...pageData("discover"), t: courseCopy.zh, id: "", offer: null as ReturnType<typeof courseCard> | null },
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || "" }); },
  onShow() { syncPage(this, "discover"); this.setData({ t: courseCopy[currentLocale()] }); void this.load(); },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: "", offer: null });
    try {
      const row = (await courseCatalog()).find(o => o.id === this.data.id && o.kind === "activity");
      if (!row) { this.setData({ error: this.data.t.closed }); return; }
      this.setData({ offer: courseCard(row, currentLocale()) });
    } catch (error) { this.setData({ error: errorText(error) }); }
    finally { this.setData({ loading: false }); }
  },
  choose() { if (this.data.offer) wx.navigateTo({ url: "/pages/course-select/index?id=" + encodeURIComponent(this.data.id) }); },
  applications() { wx.navigateTo({ url: "/pages/course-applications/index" }); },
  advisor() { wx.navigateTo({ url: "/pages/advisor/index" }); },
});
