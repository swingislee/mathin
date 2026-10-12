import { activityCatalog, activityDetail, activityImageUrl, ApiError } from "../../lib/api";
import type { ActivityPage, ActivityPageBlock } from "../../lib/activity-detail";
import { activityCopy, activityCard } from "../../lib/activity-catalog";
import { pageData, syncPage, errorText, currentLocale } from "../../lib/page";

Page({
  data: { ...pageData("discover"), t: activityCopy.zh, id: "", offer: null as ReturnType<typeof activityCard> | null,
    detail: null as (Omit<ActivityPage, "blocks"> & { coverUrl: string; blocks: (ActivityPageBlock & { imageUrl: string })[] }) | null },
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || "" }); },
  onShow() { syncPage(this, "discover"); this.setData({ t: activityCopy[currentLocale()] }); void this.load(); },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: "", offer: null, detail: null });
    try {
      const result = await activityDetail(this.data.id).catch(async error => {
        // Older servers can still provide the original text-only page.
        if (!(error instanceof ApiError) || error.code !== "NOT_FOUND") throw error;
        return { offer: (await activityCatalog()).find(o => o.id === this.data.id && o.kind === "activity"), page: null };
      });
      if (!result.offer) { this.setData({ error: this.data.t.closed }); return; }
      const detail = result.page ? { ...result.page, coverUrl: activityImageUrl(result.page.cover),
        blocks: result.page.blocks.map(block => ({ ...block, imageUrl: block.type === "text" ? "" : activityImageUrl(block.imagePath) })) } : null;
      this.setData({ offer: activityCard(result.offer, currentLocale()), detail });
    } catch (error) { this.setData({ error: errorText(error) }); }
    finally { this.setData({ loading: false }); }
  },
  previewImage(event: WechatMiniprogram.BaseEvent) {
    if (!this.data.detail) return;
    const urls = [this.data.detail.coverUrl, ...this.data.detail.blocks.map(b => b.imageUrl)].filter(Boolean);
    const current = String(event.currentTarget.dataset.src || "");
    if (urls.includes(current)) wx.previewImage({ current, urls });
  },
  choose() { if (this.data.offer) wx.navigateTo({ url: "/pages/activity-signup/index?id=" + encodeURIComponent(this.data.id) }); },
  applications() { wx.navigateTo({ url: "/pages/activity-requests/index" }); },
  service() { wx.navigateTo({ url: "/pages/service/index" }); },
});
