import { experienceRead } from "../../lib/api";
import { errorText } from "../../lib/page";
import type { ContentDocument } from "../../lib/miniapp-experience";
import type { ExperiencePublication } from "../../lib/experience-runtime";
Component({
  properties: { pageId: String, locale: { type: String, value: "zh" }, description: String, revision: Number },
  options: { pureDataPattern: /^_/ },
  data: { document: null as ContentDocument | null, images: {} as Record<string, string>, error: "", _active: false, _generation: 0, _key: "" },
  lifetimes: { attached() { this.setData({ _active: true }); void this.load(); }, detached() { this.setData({ _active: false, _generation: this.data._generation + 1 }); } },
  pageLifetimes: { show() { this.setData({ _active: true }); void this.load(); }, hide() { this.setData({ _active: false, _generation: this.data._generation + 1, _key: "", document: null, images: {}, error: "" }); } },
  observers: { "pageId, revision"() { if (this.data._active) void this.load(); } },
  methods: {
    async load() {
      const key = `${this.data.pageId}:${this.data.revision}`;
      if (key === this.data._key && !this.data.error) return;
      const generation = this.data._generation + 1, id = this.data.pageId;
      this.setData({ _key: key, _generation: generation, document: null, images: {}, error: "" });
      if (!id) return;
      try {
        const result = await experienceRead<ExperiencePublication<ContentDocument>>("page", id);
        if (!this.data._active || generation !== this.data._generation) return;
        if (result.document.audience !== "all" || result.document.purpose === "report") return;
        this.setData({ document: result.document, images: result.images });
      } catch (error) { if (this.data._active && generation === this.data._generation) this.setData({ error: errorText(error) }); }
    },
  },
});
