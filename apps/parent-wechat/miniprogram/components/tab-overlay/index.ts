// Tab 页的底部弹层覆盖到屏幕底边；关闭后恢复原生导航。
Component({
  lifetimes: {
    attached() { wx.hideTabBar({ animation: false }); },
    detached() { wx.showTabBar({ animation: false }); },
  },
});
