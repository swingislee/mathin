import { getTranslations } from "next-intl/server";
import type { OperationalEventRow } from "./classes";

const EVENT_LABEL_KEYS: Record<string, string> = {
  "classroom.created": "eventLabel_classroomCreated",
  "classroom.lifecycle.transition": "eventLabel_classroomTransition",
  "classroom.lifecycle.archived": "eventLabel_classroomArchived",
  "classroom.lifecycle.unarchived": "eventLabel_classroomUnarchived",
  "classroom.lifecycle.trashed": "eventLabel_classroomTrashed",
  "classroom.lifecycle.restored": "eventLabel_classroomRestored",
  "classroom.staff.assigned": "eventLabel_staffAssigned",
  "classroom.staff.removed": "eventLabel_staffRemoved",
  "classroom.staff.primary_support_set": "eventLabel_primarySupportSet",
  "consume_rule.updated": "eventLabel_consumeRuleUpdated",
  "session.lifecycle.cancelled": "eventLabel_sessionCancelled",
  "session.lifecycle.restored": "eventLabel_sessionRestored",
  "session.lifecycle.voided": "eventLabel_sessionVoided",
  "session_change.substitute": "eventLabel_sessionSubstitute",
  "session_family_brief.published": "eventLabel_familyBriefPublished",
  "session.courseware.blank_fallback": "eventLabel_blankCoursewareFallback",
};

/** 运营记录 tab（doc19 §13.2）：`list_classroom_operational_events` 的只读时间线。 */
export async function OperationalRecordsPanel({ events, canView }: { events: OperationalEventRow[]; canView: boolean }) {
  const t = await getTranslations("school.classes");
  if (!canView) return <p className="rounded-xl border border-line bg-card p-5 text-sm text-muted">{t("recordsTabEmpty")}</p>;

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="font-medium">{t("operationalRecordsTitle")}</h2>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("recordsTabEmpty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {events.map((event, index) => (
            <li key={`${event.eventType}-${event.occurredAt}-${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="text-ink">{t(EVENT_LABEL_KEYS[event.eventType] ?? "eventLabel_generic", { type: event.eventType })}</span>
              <span className="shrink-0 text-xs text-muted">{event.actorName || t("systemActor")} · {new Date(event.occurredAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
