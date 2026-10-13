// Every runtime page is a thin shell around runtime-host; pull-to-refresh reads the screen again.
export function registerRuntimePage() {
  Page({
    data: { id: "" },
    onLoad(query: Record<string, string | undefined>) { if (query.id) this.setData({ id: decodeURIComponent(query.id) }); },
    onPullDownRefresh() {
      const host = this.selectComponent("#host") as unknown as { reload?: () => Promise<void> } | null;
      const stop = () => wx.stopPullDownRefresh();
      Promise.resolve(host?.reload?.()).then(stop, stop);
    },
  });
}
