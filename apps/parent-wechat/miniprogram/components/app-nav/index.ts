Component({
  properties: { title: String, brand: Boolean, back: Boolean },
  data: { top: 20, height: 44, inset: 88, backLabel: "返回" },
  lifetimes: {
    attached() {
      const { statusBarHeight, windowWidth } = wx.getWindowInfo();
      const menu = wx.getMenuButtonBoundingClientRect();
      const top = statusBarHeight || 20;
      const valid = menu.height > 0 && menu.top >= top;
      this.setData({ top, height: valid ? (menu.top - top) * 2 + menu.height : 44,
        inset: valid ? windowWidth - menu.left + 8 : 88,
        backLabel: wx.getAppBaseInfo().language.toLowerCase().startsWith("en") ? "Back" : "返回" });
    },
  },
  methods: {
    goBack() {
      if (getCurrentPages().length > 1) wx.navigateBack();
      else wx.switchTab({ url: "/pages/discover/index" });
    },
  },
});
