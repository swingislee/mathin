import { miniappDocument } from "../../lib/api";
import { pageData, syncPage, currentLocale, errorText } from "../../lib/page";
import { miniappText } from "../../lib/miniapp-settings";

Page({
  data: { ...pageData("discover"), id: "", documentTitle: "", body: "", version: "" },
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || "privacy" }); },
  onShow() { syncPage(this, "discover"); void this.load(); },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: "" });
    try { const doc = await miniappDocument(this.data.id), locale = currentLocale();
      this.setData({ documentTitle: miniappText(doc.title, locale), body: miniappText(doc.body, locale), version: doc.version });
    } catch (error) { this.setData({ error: errorText(error) }); }
    finally { this.setData({ loading: false }); }
  },
});
