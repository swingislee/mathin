export const CLASSROOM_PAGING_PROTOCOL = "mathin-classroom-paging-v1";
export const CLASSROOM_PAGING_RUNTIME_PARAM = "mathin_classroom_keys";
export const CLASSROOM_PAGING_RUNTIME_VERSION = "1";

export function classroomPagingDirection(event: {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}, editing: boolean, dialogOpen: boolean): -1 | 0 | 1 {
  if (editing || dialogOpen || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0;
  if (event.key === "ArrowLeft" || event.key === "PageUp") return -1;
  if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") return 1;
  return 0;
}

export function pagingTargetIsEditing(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    "input, textarea, select, [role='textbox'], [role='combobox'], [role='spinbutton'], [contenteditable]:not([contenteditable='false'])",
  ));
}

export function pagingDialogIsOpen(doc: Document): boolean {
  return Array.from(doc.querySelectorAll<HTMLElement>(
    "dialog[open], [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]",
  )).some((element) => element.getClientRects().length > 0 && !element.closest("[inert], [aria-hidden='true']"));
}

/** 版本只属于应用注入脚本的缓存身份，课程包和资源摘要保持原值。 */
export function withClassroomPagingRuntime(href: string): string {
  const [base, ...fragments] = href.split("#");
  const queryAt = base.indexOf("?");
  const path = queryAt < 0 ? base : base.slice(0, queryAt);
  const query = new URLSearchParams(queryAt < 0 ? "" : base.slice(queryAt + 1));
  query.set(CLASSROOM_PAGING_RUNTIME_PARAM, CLASSROOM_PAGING_RUNTIME_VERSION);
  return `${path}?${query}${fragments.length ? `#${fragments.join("#")}` : ""}`;
}
