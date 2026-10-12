import { experienceRead } from "../../lib/api";
import type { ExperienceWeb } from "../../lib/experience-runtime";
import { localText } from "../../lib/miniapp-experience";
import { pageData, syncPage, currentLocale, errorText } from "../../lib/page";
import { openConfiguredAction } from "../../lib/miniapp-configuration";
Page({
  data: { ...pageData("discover"), id: "", title: "", url: "", copyUrl: "", failed: false, message: "", returnPageId: "" },
  generation: 0,
  onLoad(q: Record<string, string>) { this.setData({ id: q.id || "" }); },
  onShow() { syncPage(this, "discover"); void this.load(); },
  onUnload() { this.generation++; },
  async load() { const generation = ++this.generation; this.setData({ loading: true, error: "" });
    try { const result = await experienceRead<ExperienceWeb>("web", this.data.id, "&locale=" + currentLocale()); if (generation !== this.generation) return;
      const title = localText(result.name, currentLocale()); wx.setNavigationBarTitle({ title });
      this.setData({ title, url: result.openMode === "webview" ? result.url : "", copyUrl: result.url, failed: result.openMode === "copy", message: localText(result.unavailableMessage, currentLocale()), returnPageId: result.returnPageId });
    } catch (error) { if (generation === this.generation) this.setData({ error: errorText(error), url: "", copyUrl: "" }); }
    finally { if (generation === this.generation) this.setData({ loading: false }); }
  },
  failed() { this.setData({ failed: true, url: "" }); },
  copyLink() { if (this.data.copyUrl) wx.setClipboardData({ data: this.data.copyUrl }); },
  back() { if (this.data.returnPageId) openConfiguredAction("page", this.data.returnPageId); else wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/discover/index" }) }); },
});
