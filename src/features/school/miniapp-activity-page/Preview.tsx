/* eslint-disable @next/next/no-img-element -- Authenticated, same-origin image previews. */
import { activityPageImageUrl, type ActivityPage } from "../../../../contracts/participant-api/activity-detail";
import { pageWords } from "./messages";

export function ActivityPagePreview({ page, title, locale }: { page: ActivityPage; title: string; locale: "zh" | "en" }) {
  const t = pageWords[locale], card = page.layout === "cards";
  return <aside className="min-w-0">
    <h3 className="mb-2 text-sm font-medium">{t.preview}</h3>
    <p className="mb-4 text-xs text-muted">{t.previewHint}</p>
    <div className="mx-auto max-w-[375px] overflow-hidden rounded-3xl border border-line bg-paper text-ink shadow-sm">
      <div className="border-b border-line bg-card p-3 text-center text-sm">{t.title}</div>
      <div className={`max-h-[650px] overflow-y-auto ${card ? "space-y-3 p-3" : "bg-card"}`}>
        {page.cover && <img className={`h-auto w-full ${card ? "rounded-2xl" : ""}`} src={activityPageImageUrl(page.cover, true)} alt={t.cover} />}
        <div className={`p-5 ${card ? "rounded-2xl bg-card" : ""}`}><h4 className="text-xl font-semibold">{title}</h4><p className="mt-2 text-xs text-muted">{t.facts}</p></div>
        {page.blocks.map(block => <section key={block.id} className={`overflow-hidden ${card ? "rounded-2xl bg-card" : ""} ${block.type === "image" ? "" : "p-5"}`}>
          {block.type === "text" ? <><h5 className="mb-2 text-base font-semibold empty:hidden">{block.title}</h5><p className="whitespace-pre-wrap break-words text-sm leading-7">{block.body}</p></>
            : block.type === "image" ? <>{block.imagePath ? <img src={activityPageImageUrl(block.imagePath, true)} alt={block.caption} className="h-auto w-full" /> : <div className="bg-moon/40 p-10 text-center text-sm text-muted">{t.image}</div>}
              {block.caption && <p className="whitespace-pre-wrap px-5 py-3 text-xs text-muted">{block.caption}</p>}</>
              : <div className={`flex gap-4 ${block.position === "above" ? "flex-col" : block.position === "right" ? "flex-row-reverse" : "flex-row"}`}>
                <div className={block.position === "above" ? "w-full" : "w-2/5 shrink-0"}>
                  {block.imagePath ? <img src={activityPageImageUrl(block.imagePath, true)} alt={block.title} className="h-auto w-full rounded-lg" /> : <div className="bg-moon/40 p-4 text-center text-xs text-muted">{t.image}</div>}
                </div><div className="min-w-0 flex-1"><h5 className="mb-2 text-base font-semibold empty:hidden">{block.title}</h5><p className="whitespace-pre-wrap break-words text-sm leading-7">{block.body}</p></div>
              </div>}
        </section>)}
      </div>
      <div className="border-t border-line bg-card p-3"><span className="block rounded-full bg-rose py-3 text-center text-sm text-white">{t.reserve}</span></div>
    </div>
  </aside>;
}
