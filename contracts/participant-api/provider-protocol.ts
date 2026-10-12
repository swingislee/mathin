/** Server-to-server protocol. Credentials never belong in these messages or the public configuration. */
import type { ContentDocument, ExperienceAnswers, ExperienceForm, ExperienceText, ProviderCapability, SchedulingPolicy } from "./miniapp-experience";
import type { ContentData } from "./miniapp-content-render";
import type { ExperienceSlot } from "./experience-runtime";

export const implementedProviderCapabilities: readonly ProviderCapability[] = [
  "availability.read", "booking.read", "booking.create", "booking.cancel", "booking.reschedule", "waitlist.join", "waitlist.leave", "notifications.send",
];
type Actor = { actor: string };
type Mutation = Actor & { requestId: string };
type Page = { cursor?: string; limit: number };
type Results<T> = { items: T[]; nextCursor: string | null };
type ProviderResource = { id: string; externalId: string; capacity: number };
type Money = { currency: string; amountMinor: number };
type BookingContext = {
  serviceId: string; participantIds: string[]; form: ExperienceForm | null; answers: ExperienceAnswers;
  consents: Record<string, string>; policy: SchedulingPolicy | null; resources: ProviderResource[];
  price: Money & { mode: "free" | "offline" | "online"; note: ExperienceText };
};
export type ProviderBooking = {
  id: string; actor: string; version: number;
  status: "requested" | "confirmed" | "cancelled" | "completed" | "noShow" | "waitlisted";
  startsAt: string | null; endsAt: string | null; note: string; canCancel: boolean; canReschedule: boolean;
};
type CreateBooking = Mutation & BookingContext & { slotId?: string; startsAt?: string | null };
type ExistingBooking = Mutation & BookingContext & { bookingId: string; slotId?: string; startsAt?: string };
type Contract<Input, Output> = { input: Input; output: Output };
type CatalogService = { id: string; name: ExperienceText; summary: ExperienceText; durationMinutes: number; categoryId: string; enabled: boolean };
type Resource = ProviderResource & { name: ExperienceText; kind: "person" | "location" | "room" | "equipment" | "online" };
type ResultReport = { id: string; participantId: string; version: number; publishedAt: string; document: ContentDocument; data: ContentData };
type ServiceRecord = { id: string; serviceId: string; participantIds: string[]; occurredAt: string; status: string; summary: ExperienceText; reportIds: string[] };
type Participant = { id: string; displayName: string; relationship: "self" | "guardian" | "delegate"; permissions: ("book" | "reports" | "records")[] };
type Payment = { id: string; actor: string; bookingId: string; version: number; amount: Money; status: "pending" | "paid" | "cancelled" | "partiallyRefunded" | "refunded"; expiresAt: string | null };

/** Reserved operations have explicit data contracts; their product flows still require an adapter. */
export interface ProviderOperationContracts {
  "services.read": Contract<Actor & Page, Results<CatalogService>>;
  "resources.read": Contract<Actor & Page & { serviceId: string }, Results<Resource>>;
  "availability.read": Contract<Actor & { serviceId: string; from: string; to: string; policy: SchedulingPolicy | null; durationMinutes: number; resources: ProviderResource[] }, { slots: ExperienceSlot[] }>;
  "booking.create": Contract<CreateBooking, ProviderBooking>;
  "booking.read": Contract<ExistingBooking, ProviderBooking>;
  "booking.cancel": Contract<ExistingBooking, ProviderBooking>;
  "booking.reschedule": Contract<ExistingBooking & { slotId: string; startsAt: string }, ProviderBooking>;
  "waitlist.join": Contract<CreateBooking, ProviderBooking>;
  "waitlist.leave": Contract<ExistingBooking, ProviderBooking>;
  "forms.submit": Contract<Mutation & { formId: string; formVersion: number; participantIds: string[]; answers: ExperienceAnswers; consentVersions: Record<string, string> }, { id: string; status: "received"; receivedAt: string }>;
  "reports.read": Contract<Actor & Page & { participantId: string; reportId?: string }, Results<ResultReport>>;
  "records.read": Contract<Actor & Page & { participantId: string; from: string; to: string }, Results<ServiceRecord>>;
  "participants.read": Contract<Actor & Page, Results<Participant>>;
  "notifications.send": Contract<Mutation & { channel: "wechat" | "email" | "sms" | "webhook"; templateKey: string; event: string; title: ExperienceText; body: ExperienceText; data: Record<string, unknown> }, { accepted: true }>;
  "payment.create": Contract<Mutation & { bookingId: string; amount: Money }, { payment: Payment; destinationId: string }>;
  "payment.read": Contract<Actor & { paymentId: string }, Payment>;
  "payment.refund": Contract<Mutation & { paymentId: string; amount: Money; reason: string }, { id: string; status: "requested" | "completed" | "declined"; payment: Payment }>;
  "entitlements.read": Contract<Actor & Page & { participantId: string }, Results<{ id: string; name: ExperienceText; serviceIds: string[]; remainingUses: number | null; expiresAt: string | null }>>;
  "analytics.read": Contract<Actor & { from: string; to: string; serviceIds: string[] }, { series: { date: string; requested: number; confirmed: number; cancelled: number; completed: number; noShow: number }[] }>;
  "identity.exchange": Contract<Mutation & { destinationId: string; returnPageId: string }, { ticket: string; expiresAt: string; oneUse: true }>;
}
export type ProviderRequest<K extends keyof ProviderOperationContracts> = { version: 1; operation: K } & ProviderOperationContracts[K]["input"];
export type ProviderResponse<K extends keyof ProviderOperationContracts> = ProviderOperationContracts[K]["output"];
export type ProviderFailure = { code: "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "BOOKING_CLOSED" | "UNAVAILABLE"; retryable: boolean };
