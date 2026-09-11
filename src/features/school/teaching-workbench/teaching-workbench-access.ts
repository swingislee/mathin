export const TEACHING_WORKBENCH_PERMISSIONS = ["class.view.mine", "class.view.all"] as const;

export function hasTeachingManagementScope(perms: ReadonlySet<string>) {
  return perms.has("class.view.all");
}
