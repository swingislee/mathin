import { ApiError, bindWechat, get, login, loginWithWechat, logout, session, wechatAuthStatus } from "../../lib/api";
import type { Account, WechatAuthStatus } from "../../lib/api-types";
import { clearNavigation, hasReturn, openPage, resumeAfterLogin, selectParticipant } from "../../lib/navigation";
import { pageData, syncPage, errorText, currentLocale } from "../../lib/page";
import { activityCopy } from "../../lib/activity-catalog";
import { onboardingCopy, setOnboardingProof } from "../../lib/onboarding";
import { participantAccountName } from "../../lib/participant-wording";

Page({
  data: { ...pageData("account"), activityCopy: activityCopy.zh, authenticated: false, identifier: "", password: "", busy: false,
    account: null as Account | null, accountName: "", sheet: "", info: "", wantsWechatBinding: false,
    wechat: null as WechatAuthStatus | null, wechatLoading: true, wechatStatusFailed: false },
  loadVersion: 0,
  statusVersion: 0,
  sessionToken: "",
  onShow() {
    syncPage(this, "account");
    this.setData({ activityCopy: activityCopy[currentLocale()] });
    const current = session(), authenticated = Boolean(current), token = current?.accessToken || "";
    const reset = !current || token !== this.sessionToken;
    this.sessionToken = token;
    this.setData({ authenticated, error: "", password: "", loading: false,
      ...(reset ? { account: null, accountName: "", wechat: null } : {}),
      sheet: authenticated && this.data.wantsWechatBinding ? "bind" : !authenticated && hasReturn() ? "login" : "" });
    void this.loadWechat();
    if (authenticated) void this.load();
  },
  onHide() { this.loadVersion++; this.statusVersion++; this.setData({ password: "", sheet: "" }); },
  identifierInput(e: WechatMiniprogram.Input) { this.setData({ identifier: e.detail.value }); },
  passwordInput(e: WechatMiniprogram.Input) { this.setData({ password: e.detail.value }); },
  showAccount() { this.setData({ sheet: this.data.authenticated ? "account" : "login", error: "", info: "" }); },
  showParticipants() { this.setData({ sheet: this.data.authenticated ? "participants" : "login" }); },
  closeSheet() {
    if (this.data.busy) return;
    if (this.data.sheet === "bind") this.skipWechatBinding();
    else this.setData({ sheet: "", password: "", error: "", info: "", wantsWechatBinding: false });
  },
  noop() {},
  async signIn() {
    if (this.data.busy || !this.data.identifier.trim() || !this.data.password) return;
    const identifier = this.data.identifier.trim(), password = this.data.password;
    this.setData({ busy: true, error: "", password: "" });
    try {
      await login(identifier, password);
      this.setData({ authenticated: true, info: "", sheet: this.data.wantsWechatBinding ? "bind" : "" });
      await this.load();
      await this.loadWechat();
    } catch (error) { this.setData({ error: errorText(error) }); }
    finally { this.setData({ busy: false }); }
  },
  async signInWithWechat() {
    if (this.data.busy || !this.data.wechat?.available) return;
    this.setData({ busy: true, error: "", info: "", password: "", wantsWechatBinding: false });
    try {
      const result = await loginWithWechat();
      if (result.state === "onboarding_required") {
        setOnboardingProof(result.ticket);
        this.setData({ sheet: "" }); wx.navigateTo({ url: "/pages/onboarding/index" });
      } else if (result.state === "binding_required") {
        this.setData({ info: onboardingCopy[currentLocale()].binding });
      } else if (result.state === "authenticated") {
        this.setData({ authenticated: true, sheet: "" });
        await this.load();
        await this.loadWechat();
      } else throw new ApiError("UNAVAILABLE");
    } catch (error) { this.setData({ error: this.wechatError(error) }); }
    finally { this.setData({ busy: false }); }
  },
  showWechatBinding() {
    if (this.data.busy || !this.data.wechat?.canBind) return;
    this.setData({ sheet: "bind", wantsWechatBinding: true, password: "", error: "", info: "" });
  },
  async confirmWechatBinding() {
    if (this.data.busy || !this.data.account || !this.data.wechat?.canBind || !this.data.password) return;
    const password = this.data.password;
    this.setData({ busy: true, error: "", info: "", password: "" });
    try {
      await bindWechat(password);
      this.setData({ wantsWechatBinding: false, sheet: "account", info: this.data.copy.wechatBound });
      resumeAfterLogin();
    } catch (error) { this.setData({ error: this.wechatError(error) }); }
    finally { await this.loadWechat(); this.setData({ busy: false }); }
  },
  skipWechatBinding() {
    if (this.data.busy) return;
    this.setData({ wantsWechatBinding: false, sheet: "", password: "", error: "", info: "" });
    if (this.data.account) resumeAfterLogin();
    else if (session()) void this.load();
  },
  async loadWechat() {
    const version = ++this.statusVersion;
    this.setData({ wechatLoading: !this.data.wechat, wechatStatusFailed: false });
    try {
      const status = await wechatAuthStatus();
      if (version === this.statusVersion) this.setData({ wechat: status });
    } catch {
      if (version === this.statusVersion) this.setData({ wechat: null, wechatStatusFailed: true });
    } finally { if (version === this.statusVersion) this.setData({ wechatLoading: false }); }
  },
  wechatError(error: unknown) {
    const reasons = {
      WECHAT_NOT_CONFIGURED: "wechatUnavailable", WECHAT_CODE_INVALID: "wechatCodeError",
      WECHAT_UNIONID_REQUIRED: "wechatVerifyUnavailable", WECHAT_CREDENTIALS_INVALID: "wechatPasswordError",
      WECHAT_MFA_REQUIRED: "wechatMfaRequired", WECHAT_PHONE_LINKING_UNAVAILABLE: "wechatPhoneUnavailable",
    } as const;
    const reason = error instanceof ApiError ? error.reason : undefined;
    const key = reason && reasons[reason as keyof typeof reasons];
    return key ? this.data.copy[key] : errorText(error);
  },
  async signOut() {
    if (this.data.busy) return;
    this.loadVersion++;
    this.setData({ busy: true });
    try { await logout(); } catch { /* 本机会话由 API finally 清除。 */ }
    finally {
      clearNavigation();
      this.sessionToken = "";
      this.setData({ busy: false, authenticated: false, account: null, accountName: "", error: "", password: "", identifier: "", loading: false, sheet: "",
        info: "", wantsWechatBinding: false, wechat: null });
      void this.loadWechat();
    }
  },
  async load() {
    const version = ++this.loadVersion;
    this.setData({ loading: !this.data.account, error: "" });
    try {
      const account = await get<Account>("account");
      if (version === this.loadVersion) {
        this.sessionToken = session()?.accessToken || "";
        this.setData({ account, accountName: participantAccountName(account.displayName) });
        if (!this.data.wantsWechatBinding) resumeAfterLogin();
      }
    } catch (error) {
      if (version === this.loadVersion) {
        const current = session();
        this.setData({ error: errorText(error), authenticated: Boolean(current),
          ...(!current || current.accessToken !== this.sessionToken ? { account: null, accountName: "" } : {}) });
      }
    } finally { if (version === this.loadVersion) this.setData({ loading: false }); }
  },
  open(e: WechatMiniprogram.TouchEvent) { openPage(String(e.currentTarget.dataset.url)); },
  participant(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id);
    if (!this.data.account?.participants.some(row => row.id === id)) return;
    selectParticipant(id); this.setData({ sheet: "" }); wx.switchTab({ url: "/pages/calendar/index" });
  },
  privacy() { wx.showModal({ title: this.data.copy.privacyEntry, content: this.data.copy.privacySummary, showCancel: false }); },
});
