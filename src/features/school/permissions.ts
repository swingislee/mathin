export const PERMISSION_KEYS = [
  "student.view.all",
  "student.view.assigned",
  "student.edit",
  "student.create",
  "student.assign",
  "student.import",
  "student.delete",
  "followup.view",
  "followup.write",
  "activity.manage",
  "activity.register",
  "review.write",
  "video.review",
  "course.view",
  "course.manage",
  "course.view.all",
  "course.product.create",
  "course.assignment.manage",
  "courseware.template.edit",
  "courseware.overlay.edit",
  "courseware.microcourse.author",
  "courseware.page.edit",
  "courseware.asset.manage",
  "courseware.release.publish",
  "courseware.review",
  "courseware.emergency_publish",
  "class.view.all",
  "class.view.mine",
  "class.create",
  "class.manage",
  "enrollment.manage",
  "schedule.view.all",
  "schedule.manage",
  "attendance.mark",
  "grading.write",
  "report.view.all",
  "session.void",
  "session.postwork.manage",
  "finance.order.view",
  "finance.order.create",
  "finance.payment.record",
  "finance.refund.request",
  "finance.refund.approve",
  "finance.coupon.manage",
  "finance.scholarship.grant",
  "finance.account.adjust",
  "finance.report.view",
  "staff.manage",
  "permission.configure",
  "registration.invite.manage",
  "organization.settings.manage",
  "organization.profile.manage",
  "location.manage",
  "system.operations.manage",
  "account.support.manage",
  "work_item.manage",
  "approval.manage",
  "audit.view",
  "testdata.purge",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/**
 * `organization.settings.manage` remains in the database for the previous-app
 * rollback window. New role configuration uses the split profile/location
 * permissions and must not offer the compatibility key as a live product
 * choice. Existing assignments are preserved when a role is saved.
 */
export const ROLE_CONFIGURABLE_PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_KEYS.filter(
  (key) => key !== "organization.settings.manage",
);

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}
