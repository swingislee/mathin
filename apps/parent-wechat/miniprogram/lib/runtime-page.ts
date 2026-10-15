// Every runtime page is a thin shell around runtime-host; pull-to-refresh reads the screen again and sharing uses the screen's share card.
type Host = { reload?: () => Promise<void>; data?: { share: { title: string; image: string } | null; title: string } };
const queryString = (options: Record<string, string | undefined>) => Object.entries(options).filter(([, value]) => value !== undefined)
  .map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(String(value))).join("&");

export function registerRuntimePage() {
  Page({
    data: { id: "" },
    onLoad(query: Record<string, string | undefined>) { if (query.id) this.setData({ id: decodeURIComponent(query.id) }); },
    onPullDownRefresh() {
      const host = this.selectComponent("#host") as unknown as Host | null;
      const stop = () => wx.stopPullDownRefresh();
      Promise.resolve(host?.reload?.()).then(stop, stop);
    },
    onShareAppMessage() {
      const host = this.selectComponent("#host") as unknown as Host | null, share = host?.data?.share;
      const page = getCurrentPages().slice(-1)[0] as unknown as { route: string; options?: Record<string, string> };
      const search = queryString(page.options || {});
      return { title: share?.title || host?.data?.title || "", path: "/" + page.route + (search ? "?" + search : ""), ...(share?.image ? { imageUrl: share.image } : {}) };
    },
    onShareTimeline() {
      const host = this.selectComponent("#host") as unknown as Host | null, share = host?.data?.share;
      const page = getCurrentPages().slice(-1)[0] as unknown as { options?: Record<string, string> };
      return { title: share?.title || host?.data?.title || "", query: queryString(page.options || {}), ...(share?.image ? { imageUrl: share.image } : {}) };
    },
  });
}
