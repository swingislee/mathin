import { acceptConsentDocuments, consentDocuments, miniappDocument } from "../../lib/api";
import { pageData, syncPage, currentLocale, errorText } from "../../lib/page";
import { miniappText } from "../../lib/miniapp-settings";

Page({
  data: { ...pageData("discover"), id: "", documentTitle: "", body: "", version: "", consentRequired: false, accepted: false,
    busy: false, privacyVersion: "", childrenPrivacyVersion: "", documents: [] as { id: string; title: string; version: string; body: string }[] },
  readVersion: 0,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || "privacy", consentRequired: query.consent === "1" }); },
  onShow() { syncPage(this, "discover"); if (!this.data.busy) { this.setData({ loading: false }); void this.load(); } },
  onHide() { this.readVersion++; },
  async load() {
    if (this.data.loading) return;
    const generation = ++this.readVersion;
    this.setData({ loading: true, error: "", accepted: false });
    try {
      const locale = currentLocale();
      if (this.data.consentRequired) {
        const current = await consentDocuments(); if (generation !== this.readVersion) return;
        this.setData({ documentTitle: locale === "en" ? "Updated privacy information" : "隐私说明已更新", privacyVersion: current.privacyVersion, childrenPrivacyVersion: current.childrenPrivacyVersion,
          documents: [
            { id: "privacy", title: locale === "en" ? "Privacy" : "隐私保护", version: current.privacyVersion, body: current.policyText[locale].privacy },
            { id: "children_privacy", title: locale === "en" ? "Children's privacy" : "儿童隐私保护", version: current.childrenPrivacyVersion, body: current.policyText[locale].children },
          ] }); return;
      }
      const doc = await miniappDocument(this.data.id); if (generation !== this.readVersion) return;
      this.setData({ documentTitle: miniappText(doc.title, locale), body: miniappText(doc.body, locale), version: doc.version });
    } catch (error) { if (generation === this.readVersion) this.setData({ error: errorText(error), body: "", documents: [] }); }
    finally { if (generation === this.readVersion) this.setData({ loading: false }); }
  },
  consent(e: WechatMiniprogram.CheckboxGroupChange) { this.setData({ accepted: e.detail.value.includes("agree") }); },
  async accept() {
    if (this.data.busy || this.data.loading || !this.data.accepted || !this.data.privacyVersion || !this.data.childrenPrivacyVersion) return;
    this.setData({ busy: true, error: "" });
    try {
      await acceptConsentDocuments(this.data.privacyVersion, this.data.childrenPrivacyVersion);
      if (getCurrentPages().length > 1) wx.navigateBack(); else wx.switchTab({ url: "/pages/account/index" });
    } catch (error) { this.setData({ error: errorText(error), accepted: false }); }
    finally { this.setData({ busy: false }); }
  },
  browse() { if (!this.data.busy) wx.switchTab({ url: "/pages/discover/index" }); },
});
