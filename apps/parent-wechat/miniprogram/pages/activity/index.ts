// Preserve older activity links while routing new sign-ups to pre-registration.
Page({ onLoad(query: Record<string, string>) {
  wx.redirectTo({ url: query.id ? "/pages/course-detail/index?id=" + encodeURIComponent(query.id) : "/pages/course-catalog/index" });
} });
