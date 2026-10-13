import { renderContent, type ContentData, type RenderedContentBlock } from "../../lib/miniapp-content-render";
import { localText, type ContentDocument, type ExperienceAction } from "../../lib/miniapp-experience";
import { configuration, openConfiguredAction } from "../../lib/miniapp-configuration";
import { openExperienceAction } from "../../lib/experience-actions";
import { activityCatalog, serviceContacts, miniappContentImage } from "../../lib/api";
import { activityCard } from "../../lib/activity-catalog";
import { serviceCard } from "../../lib/service-card";
type Row = RenderedContentBlock & { cards: { id: string; title: string; text: string; image: string; meta?: string; action: ExperienceAction }[]; activities: ReturnType<typeof activityCard>[] };
Component({
  properties: { document: { type: Object, value: null as ContentDocument | null }, context: { type: Object, value: {} as ContentData }, images: { type: Object, value: {} as Record<string, string> }, locale: { type: String, value: "zh" } },
  data: { rows: [] as Row[], expanded: {} as Record<string, boolean>, generation: 0 },
  observers: { "document, context, images, locale"() { this.render(); } },
  lifetimes: { detached() { this.setData({ rows: [], generation: this.data.generation + 1 }); } },
  methods: {
    render() {
      const document = this.properties.document as ContentDocument | null, locale = this.properties.locale === "en" ? "en" : "zh";
      if (!document) { this.setData({ rows: [] }); return; }
      const image = (path: string) => this.properties.images[path] || (document.audience === "all" ? miniappContentImage(path) : "");
      const rows: Row[] = renderContent(document, this.properties.context, locale).map(row => ({ ...row, image: image(row.image), items: row.items.map(i => ({ ...i, image: image(i.image) })), cards: [], activities: [] }));
      for (const row of rows) if (row.kind === "services") row.cards = (configuration().experience?.services || []).filter(s => s.enabled && (!row.ids.length || row.ids.includes(s.id))).slice(0, row.limit)
        .map(s => ({ ...serviceCard(s, locale, miniappContentImage(s.image, true)), action: { kind: "offering", target: s.id, label: s.name } }));
      const generation = this.data.generation + 1;
      this.setData({ rows, generation });
      if (rows.some(r => r.kind === "activities")) void activityCatalog().then(offers => {
        if (this.data.generation !== generation) return;
        this.setData({ rows: this.data.rows.map(r => r.kind !== "activities" ? r : { ...r, activities: offers.filter(o => !r.ids.length || r.ids.includes(o.id)).slice(0, r.limit).map(o => activityCard(o, locale)) }) });
      }).catch(() => {});
      if (rows.some(r => r.kind === "contacts")) void serviceContacts().then(contacts => {
        if (this.data.generation !== generation) return;
        const seen = new Set<string>();
        const unique = contacts.filter(c => { const id = c.id || c.phone; if (seen.has(id)) return false; seen.add(id); return true; });
        this.setData({ rows: this.data.rows.map(r => r.kind !== "contacts" ? r : { ...r, cards: unique.filter(c => !r.ids.length || r.ids.includes(c.id || "")).slice(0, r.limit).map(c => ({ id: c.id || c.phone, title: c.name ? localText(c.name, locale) : c.facilitatorName, text: localText(c.service, locale) + (c.phone ? " · " + c.phone : ""), image: "", action: { kind: c.phone ? "phone" : "native", target: c.phone || "service", label: { zh: "联系", en: "Contact" } } })) }) });
      }).catch(() => {});
    },
    action(e: WechatMiniprogram.TouchEvent) { const row = this.data.rows.find(r => r.id === e.currentTarget.dataset.id); openExperienceAction(row?.action); },
    card(e: WechatMiniprogram.CustomEvent<{ id: string }>) { const row = this.data.rows.find(r => r.id === e.currentTarget.dataset.block); if (row?.kind === "activities" && row.activities.some(a => a.id === e.detail.id)) wx.navigateTo({ url: "/pages/activity-detail/index?id=" + encodeURIComponent(e.detail.id) }); else openExperienceAction(row?.cards.find(c => c.id === e.detail.id)?.action); },
    toggle(e: WechatMiniprogram.TouchEvent) { const key = String(e.currentTarget.dataset.key); this.setData({ expanded: { ...this.data.expanded, [key]: !this.data.expanded[key] } }); },
    directory(e: WechatMiniprogram.TouchEvent) { openConfiguredAction(e.currentTarget.dataset.kind === "contacts" ? "service" : "activities"); },
    image(e: WechatMiniprogram.TouchEvent) { const url = String(e.currentTarget.dataset.url || ""); if (url) wx.previewImage({ current: url, urls: [url] }); },
  },
});
