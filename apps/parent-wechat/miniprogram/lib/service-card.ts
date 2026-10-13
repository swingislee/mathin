import { localText, type ExperienceLocale, type ExperienceService } from "./miniapp-experience";
/** One projection feeds both the native catalog and composed-page service modules. */
export function serviceCard(service: ExperienceService, locale: ExperienceLocale, image: string) {
  return { id: service.id, title: localText(service.name, locale), text: localText(service.summary, locale), image,
    meta: service.price.mode === "free" ? (locale === "en" ? "Free" : "免费") : `${service.price.currency} ${(service.price.amountMinor / 100).toFixed(2)}` };
}
