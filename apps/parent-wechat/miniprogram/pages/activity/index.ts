// Preserve older activity links while routing new sign-ups to pre-registration.
Page({ onLoad(query: Record<string, string>) {
  wx.redirectTo({ url: query.id ? "/pages/activity-detail/index?id=" + encodeURIComponent(query.id) : "/pages/activity-catalog/index" });
} });
