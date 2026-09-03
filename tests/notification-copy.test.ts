import { describe, expect, it } from "vitest";
import {
  notificationValueKey,
  renderNotificationDetail,
  resolveNotificationDetail,
} from "@/features/events/notification-copy";

describe("notification copy", () => {
  it("turns import facts into a locale-neutral template contract", () => {
    expect(resolveNotificationDetail("class_import.validated", {
      total: 12,
      valid: 8,
      duplicates: 3,
      errors: 1,
    })).toEqual({
      kind: "translated",
      key: "importValidated",
      values: { total: 12, valid: 8, duplicates: 3, errors: 1 },
    });
  });

  it("localizes machine values while preserving the structured event", () => {
    const detail = resolveNotificationDetail("lead.communication.recorded", {
      outcome: "invalid_number",
      status: "invalid",
    });
    expect(detail).not.toBeNull();
    expect(renderNotificationDetail(
      detail!,
      (key, values) => `${key}:${values.outcome}:${values.status}`,
      (group, value) => `${group}.${value}`,
    )).toBe("leadCommunication:outcome.invalid_number:status.invalid");
  });

  it("keeps entity names and user-entered reasons as literal copy", () => {
    expect(resolveNotificationDetail("custom.event", { title: "Epsilon Lab" })).toEqual({
      kind: "literal",
      value: "Epsilon Lab",
    });
    expect(resolveNotificationDetail("custom.event", { reason: "家长希望下周再联系" })).toEqual({
      kind: "literal",
      value: "家长希望下周再联系",
    });
  });

  it("keeps legacy prose as the final fallback", () => {
    expect(resolveNotificationDetail("legacy.event", { message: "Imported 3 records" })).toEqual({
      kind: "literal",
      value: "Imported 3 records",
    });
  });

  it("normalizes enum and field names into message keys", () => {
    expect(notificationValueKey("status", "intent_confirmed")).toBe("status_intent_confirmed");
    expect(notificationValueKey("field", "scheduledAt")).toBe("field_scheduled_at");
  });
});
