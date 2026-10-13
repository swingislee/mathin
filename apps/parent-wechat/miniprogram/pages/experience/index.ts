import { configuredPage } from "../../lib/native-page";
import { experienceRead } from "../../lib/api";
import { pageData, syncPage, currentLocale, errorText } from "../../lib/page";
import { localText, type ContentDocument } from "../../lib/miniapp-experience";
import type { ExperiencePublication } from "../../lib/experience-runtime";
configuredPage("experience")({
  data: { ...pageData("discover"), id: "", title: "", document: null as ContentDocument | null, images: {} as Record<string, string> },
  generation: 0,
  onLoad(q: Record<string, string>) { this.setData({ id: q.id || "" }); },
  onShow() { syncPage(this, "discover"); void this.load(); },
  onHide() { this.generation++; this.setData({ document: null, images: {}, loading: false }); },
  onUnload() { this.generation++; },
  async load() { const generation = ++this.generation; this.setData({ loading: true, error: "" });
    try { const result = await experienceRead<ExperiencePublication<ContentDocument>>("page", this.data.id); if (generation !== this.generation) return;
      this.setData({ document: result.document, images: result.images, title: localText(result.document.title, currentLocale()) });
    } catch (error) { if (generation === this.generation) this.setData({ error: errorText(error) }); }
    finally { if (generation === this.generation) this.setData({ loading: false }); }
  },
});
