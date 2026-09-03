export type NotificationValueGroup =
  | "decision"
  | "field"
  | "kind"
  | "outcome"
  | "responsibility"
  | "scope"
  | "status";

export type NotificationDetailKey =
  | "changedFields"
  | "classroomCreated"
  | "importCompleted"
  | "importValidated"
  | "kind"
  | "leadAssigned"
  | "leadCommunication"
  | "leadImportCompleted"
  | "responsibility"
  | "rolesApplied"
  | "rowDecided"
  | "scopeChanged"
  | "status"
  | "taskCompleted";

export interface LocalizedNotificationValue {
  kind: "localized";
  group: NotificationValueGroup;
  value: string;
}

export interface LocalizedNotificationList {
  kind: "localized-list";
  group: NotificationValueGroup;
  values: string[];
}

export type NotificationDetailValue = string | number | LocalizedNotificationValue | LocalizedNotificationList;

export type NotificationDetail =
  | { kind: "literal"; value: string }
  | { kind: "translated"; key: NotificationDetailKey; values: Record<string, NotificationDetailValue> };

const VALIDATED_IMPORT_TYPES = new Set([
  "class_import.validated",
  "data_import.validated",
  "lead_import.validated",
  "student_import.validated",
]);

const COMPLETED_IMPORT_TYPES = new Set([
  "class_import.completed",
  "data_import.completed",
  "student_import.completed",
]);

function text(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function number(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstNumber(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = number(payload, key);
    if (value !== null) return value;
  }
  return null;
}

function localized(group: NotificationValueGroup, value: string): LocalizedNotificationValue {
  return { kind: "localized", group, value };
}

function translated(
  key: NotificationDetailKey,
  values: Record<string, NotificationDetailValue>,
): NotificationDetail {
  return { kind: "translated", key, values };
}

function importValidationDetail(payload: Record<string, unknown>): NotificationDetail | null {
  const total = number(payload, "total");
  const valid = number(payload, "valid");
  const duplicates = number(payload, "duplicates");
  const errors = number(payload, "errors");
  return total !== null && valid !== null && duplicates !== null && errors !== null
    ? translated("importValidated", { total, valid, duplicates, errors })
    : null;
}

function importCompletionDetail(payload: Record<string, unknown>): NotificationDetail | null {
  const completed = firstNumber(payload, ["inserted", "issued"]);
  const duplicates = number(payload, "duplicates");
  return completed !== null && duplicates !== null
    ? translated("importCompleted", { completed, duplicates })
    : null;
}

/** Resolve locale-neutral notification facts before the client applies the active locale. */
export function resolveNotificationDetail(
  type: string,
  payload: Record<string, unknown>,
): NotificationDetail | null {
  if (VALIDATED_IMPORT_TYPES.has(type)) {
    const detail = importValidationDetail(payload);
    if (detail) return detail;
  }

  if (COMPLETED_IMPORT_TYPES.has(type)) {
    const detail = importCompletionDetail(payload);
    if (detail) return detail;
  }

  if (type === "lead_import.completed") {
    const created = number(payload, "createdLeadSeeds");
    const applied = number(payload, "appliedRows");
    if (created !== null && applied !== null) return translated("leadImportCompleted", { created, applied });
  }

  if (type === "lead_import.row_decided") {
    const row = number(payload, "row");
    const decision = text(payload, "decision");
    if (row !== null && decision) return translated("rowDecided", { row, decision: localized("decision", decision) });
  }

  if (type === "lead.assignment.batch") {
    const count = number(payload, "count");
    if (count !== null) return translated("leadAssigned", { count });
  }

  if (type === "lead.communication.recorded") {
    const outcome = text(payload, "outcome");
    const status = text(payload, "status");
    if (outcome && status) {
      return translated("leadCommunication", {
        outcome: localized("outcome", outcome),
        status: localized("status", status),
      });
    }
  }

  if (type === "classroom.created") {
    const sessions = number(payload, "sessionCount");
    const status = text(payload, "operationalStatus");
    if (sessions !== null && status) {
      return translated("classroomCreated", { sessions, status: localized("status", status) });
    }
  }

  if (type === "support_task.completed" || type === "session_task.completed") {
    const taskKind = text(payload, "kind");
    const status = text(payload, "status");
    if (taskKind && status) {
      return translated("taskCompleted", {
        kind: localized("kind", taskKind),
        status: localized("status", status),
      });
    }
  }

  if (type === "staff.invitation_roles_applied") {
    const requested = number(payload, "requestedRoles");
    const assigned = number(payload, "assignedRoles");
    if (requested !== null && assigned !== null) return translated("rolesApplied", { requested, assigned });
  }

  if (type === "classroom.staff.assigned" || type === "classroom.staff.removed") {
    const responsibility = text(payload, "responsibility");
    if (responsibility) {
      return translated("responsibility", { responsibility: localized("responsibility", responsibility) });
    }
  }

  if (type === "guardian.scope_updated" && Array.isArray(payload.scope)) {
    const scopes = payload.scope.filter((value): value is string => typeof value === "string" && value.length > 0);
    if (scopes.length > 0) {
      return translated("scopeChanged", { scope: { kind: "localized-list", group: "scope", values: scopes } });
    }
  }

  for (const key of ["title", "studentName", "classroomName", "sessionTitle", "reason"] as const) {
    const value = text(payload, key);
    if (value) return { kind: "literal", value };
  }

  const status = text(payload, "status");
  if (status) return translated("status", { status: localized("status", status) });

  const kind = text(payload, "kind");
  if (kind) return translated("kind", { kind: localized("kind", kind) });

  if (Array.isArray(payload.changedFields)) {
    const fields = payload.changedFields.filter((value): value is string => typeof value === "string" && value.length > 0);
    if (fields.length > 0) {
      return translated("changedFields", { fields: { kind: "localized-list", group: "field", values: fields } });
    }
  }

  const legacyMessage = text(payload, "message");
  return legacyMessage ? { kind: "literal", value: legacyMessage } : null;
}

export function notificationValueKey(group: NotificationValueGroup, value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return `${group}_${normalized}`;
}

export function renderNotificationDetail(
  detail: NotificationDetail,
  translate: (key: NotificationDetailKey, values: Record<string, string | number>) => string,
  localize: (group: NotificationValueGroup, value: string) => string,
): string {
  if (detail.kind === "literal") return detail.value;
  const values = Object.fromEntries(Object.entries(detail.values).map(([key, value]) => {
    if (typeof value === "string" || typeof value === "number") return [key, value];
    if (value.kind === "localized") return [key, localize(value.group, value.value)];
    return [key, value.values.map((item) => localize(value.group, item)).join(" · ")];
  }));
  return translate(detail.key, values);
}
