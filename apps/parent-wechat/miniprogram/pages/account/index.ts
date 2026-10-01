import { get, login, logout, session } from "../../lib/api";
import type { Account } from "../../lib/api-types";
import { clearNavigation, openPage, resumeAfterLogin, selectParticipant } from "../../lib/navigation";
import { pageData, syncPage, errorText } from "../../lib/page";

Page({
  data: { ...pageData("account"), authenticated: false, identifier: "", password: "", busy: false, account: null as Account | null },
  loadVersion: 0,
  onShow() {
    syncPage(this, "account");
    this.setData({ authenticated: Boolean(session()), account: null, error: "", password: "", loading: false });
    if (session()) void this.load();
  },
  onHide() { this.loadVersion++; this.setData({ password: "" }); },
  identifierInput(e: WechatMiniprogram.Input) { this.setData({ identifier: e.detail.value }); },
  passwordInput(e: WechatMiniprogram.Input) { this.setData({ password: e.detail.value }); },
  async signIn() {
    if (this.data.busy || !this.data.identifier.trim() || !this.data.password) return;
    this.setData({ busy: true, error: "" });
    try {
      await login(this.data.identifier.trim(), this.data.password);
      this.setData({ authenticated: true, password: "" });
      await this.load();
    } catch (error) { this.setData({ error: errorText(error) }); }
    finally { this.setData({ busy: false }); }
  },
  async signOut() {
    if (this.data.busy) return;
    this.loadVersion++;
    this.setData({ busy: true });
    try { await logout(); } catch { /* 本机会话由 API finally 清除。 */ }
    finally {
      clearNavigation();
      this.setData({ busy: false, authenticated: false, account: null, error: "", password: "", identifier: "", loading: false });
    }
  },
  async load() {
    const version = ++this.loadVersion;
    this.setData({ loading: true, error: "" });
    try {
      const account = await get<Account>("account");
      if (version === this.loadVersion) {
        this.setData({ account });
        resumeAfterLogin();
      }
    } catch (error) {
      if (version === this.loadVersion) this.setData({ error: errorText(error), authenticated: Boolean(session()) });
    } finally { if (version === this.loadVersion) this.setData({ loading: false }); }
  },
  open(e: WechatMiniprogram.TouchEvent) { openPage(String(e.currentTarget.dataset.url)); },
  participant(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id);
    if (!this.data.account?.participants.some(row => row.id === id)) return;
    selectParticipant(id); wx.switchTab({ url: "/pages/agenda/index" });
  },
  privacy() { wx.showModal({ title: this.data.copy.privacyEntry, content: this.data.copy.privacySummary, showCancel: false }); },
});
