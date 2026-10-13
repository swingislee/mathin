import { ApiError, cancelPendingAuthentication, loginWithWechat, wechatAuthStatus } from "../../lib/api";
import type { WechatAuthStatus } from "../../lib/api-types";
import { cancelLogin, isTabPath, takeReturn } from "../../lib/navigation";
import { pageData, syncPage, errorText } from "../../lib/page";
import { clearOnboardingEntry, clearPromotionScene, onboardingCopy, openOnboarding, pendingPromotionScene, setOnboardingProof } from "../../lib/onboarding";
import { clearRuntimeSession, refreshApp, runtimeLocale } from "../../lib/runtime";

// WeChat sign-in shared by every runtime screen and original page; leaving returns to where it was requested.
Page({
  data: { ...pageData("account"), busy: false, info: "", wechat: null as WechatAuthStatus | null, wechatLoading: true, wechatStatusFailed: false },
  version: 0, statusVersion: 0, done: false,
  onShow() { syncPage(this, "account", "login"); void this.loadWechat(); },
  onUnload() {
    if (this.done) return;
    this.version++; cancelPendingAuthentication(); cancelLogin(); clearOnboardingEntry();
  },
  async loadWechat() {
    const version = ++this.statusVersion;
    this.setData({ wechatLoading: !this.data.wechat, wechatStatusFailed: false });
    try { const status = await wechatAuthStatus(); if (version === this.statusVersion) this.setData({ wechat: status }); }
    catch { if (version === this.statusVersion) this.setData({ wechat: null, wechatStatusFailed: true }); }
    finally { if (version === this.statusVersion) this.setData({ wechatLoading: false }); }
  },
  async signIn() {
    if (this.data.busy || !this.data.wechat?.available) return;
    const version = ++this.version, scene = pendingPromotionScene();
    this.setData({ busy: true, error: "", info: "" });
    try {
      const result = await loginWithWechat(scene || undefined);
      if (version !== this.version) return;
      if (result.state === "onboarding_required") {
        setOnboardingProof(result.ticket, scene, Boolean(result.phoneVerified));
        this.done = true; openOnboarding();
      } else if (result.state === "binding_required") {
        this.setData({ info: onboardingCopy[runtimeLocale()].binding });
      } else if (result.state === "authenticated") {
        clearPromotionScene(scene); clearRuntimeSession(); void refreshApp(true);
        this.done = true;
        this.finish(takeReturn());
      } else throw new ApiError("UNAVAILABLE");
    } catch (error) { if (version === this.version) this.setData({ error: this.wechatError(error) }); }
    finally { if (version === this.version) this.setData({ busy: false }); }
  },
  wechatError(error: unknown) {
    const reasons = {
      WECHAT_NOT_CONFIGURED: "wechatUnavailable", WECHAT_CODE_INVALID: "wechatCodeError",
      WECHAT_UNIONID_REQUIRED: "wechatVerifyUnavailable", WECHAT_CREDENTIALS_INVALID: "wechatBindUnavailable",
      WECHAT_MFA_REQUIRED: "wechatMfaRequired", WECHAT_PHONE_LINKING_UNAVAILABLE: "wechatPhoneUnavailable",
    } as const;
    const reason = error instanceof ApiError ? error.reason : undefined;
    const key = reason && reasons[reason as keyof typeof reasons];
    return key ? this.data.copy[key] : errorText(error);
  },
  /** Returns to the page that asked for sign-in, or opens the different page it named. */
  finish(target: string) {
    const below = getCurrentPages().slice(-2, -1)[0];
    if (!target || (below && target.split("?")[0] === "/" + below.route)) this.leave();
    else if (isTabPath(target)) wx.switchTab({ url: target });
    else wx.redirectTo({ url: target });
  },
  leave() { if (getCurrentPages().length > 1) wx.navigateBack(); else wx.switchTab({ url: "/pages/discover/index" }); },
  browse() { this.leave(); },
});
