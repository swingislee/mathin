type CardView = { id: string; refreshSeconds: number; image: string; action: unknown };
// Certificates, credentials and info cards. A credential with a refresh interval asks the page for a new code while it is visible.
Component({
  options: { styleIsolation: "apply-shared" },
  properties: { block: { type: Object, value: {} }, strings: { type: Object, value: {} } },
  data: { _timer: 0 },
  lifetimes: { attached() { this.start(); }, detached() { this.stop(); } },
  pageLifetimes: { show() { this.start(); }, hide() { this.stop(); } },
  observers: { "block.refreshSeconds"() { this.start(); } },
  methods: {
    start() {
      this.stop();
      const seconds = (this.data.block as CardView).refreshSeconds;
      if (seconds > 0) this.setData({ _timer: setInterval(() => this.triggerEvent("refresh", { block: (this.data.block as CardView).id }), Math.max(15, seconds) * 1000) as unknown as number });
    },
    stop() { if (this.data._timer) { clearInterval(this.data._timer); this.setData({ _timer: 0 }); } },
    act() { const block = this.data.block as CardView; if (block.action) this.triggerEvent("action", { action: block.action }); },
    preview() { const block = this.data.block as CardView; if (block.image) wx.previewImage({ urls: [block.image] }); },
    login() { this.triggerEvent("action", { action: { type: "login" } }); },
  },
});
