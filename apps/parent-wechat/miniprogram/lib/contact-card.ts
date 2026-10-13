import { localText, type ExperienceLocale } from "./miniapp-experience";
import type { ServiceContact } from "./api-types";
export function contactCard(contact: ServiceContact, locale: ExperienceLocale) {
  return { id: contact.id || `${contact.phone}-${contact.stageNumber}-${contact.campusId || ""}`, name: contact.name ? localText(contact.name, locale) : contact.facilitatorName,
    service: localText(contact.service, locale), campus: contact.campusName || "", qrImage: contact.qrCodeUrl || "", phone: contact.phone || "",
    hours: localText(contact.hours, locale), address: localText(contact.address, locale) };
}
export type ContactCard = ReturnType<typeof contactCard>;
