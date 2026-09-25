import type { FocusEvent, KeyboardEvent } from "react";

/** 键盘聚焦即时激活；鼠标点击的激活与展开在同一个 click 更新中完成。 */
export function followupFocusActivatesRow(event: FocusEvent<HTMLElement>): boolean {
  return event.target.matches(":focus-visible");
}

export const CONTACT_OUTCOME_SHORTCUTS = [
  { key: "1", outcome: "unreachable" },
  { key: "2", outcome: "connected" },
  { key: "3", outcome: "declined" },
  { key: "4", outcome: "invalid_number" },
] as const;

type KeyInput = Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "repeat" | "defaultPrevented"> & {
  isComposing?: boolean;
};

export function followupKeyboardCommand(event: KeyInput, { editing = false, overlay = false } = {}) {
  if (overlay || event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.shiftKey) return null;
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") return { type: "save" } as const;
  if (event.ctrlKey || event.metaKey) return null;
  if (event.key === "Escape") return { type: "close" } as const;
  if (editing) return null;
  if (event.key === "0") return { type: "outcome", outcome: "" } as const;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") return { type: "move", direction: event.key === "ArrowDown" ? 1 : -1 } as const;
  const shortcut = CONTACT_OUTCOME_SHORTCUTS.find((item) => item.key === event.key);
  return shortcut ? { type: "outcome", outcome: shortcut.outcome } as const : null;
}

/** Portal 内的日期、下拉与对话框保留自己的键盘作用域。 */
export function followupKeyContext(event: Pick<KeyboardEvent<HTMLElement>, "target" | "currentTarget">) {
  const target = event.target as Element;
  return {
    overlay: !event.currentTarget.contains(target) || Boolean(target.closest("[role='dialog'],[role='listbox'],[role='menu']")),
    editing: Boolean(target.closest("input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox'],[role='combobox'],[role='option'],[role='spinbutton'],[role='slider'],[role='grid']")),
  };
}

export function adjacentFollowupKey(keys: readonly string[], current: string, direction: number): string | null {
  const index = keys.indexOf(current);
  return index < 0 ? null : keys[index + direction] ?? null;
}

/** 摘要和详情共用可见行顺序；切换只移动工作焦点，不保存或完成记录。 */
export type FollowupNavigationMode = "records" | "tree";
type Navigate = (key: string) => boolean;
const navigationScopes = new WeakMap<HTMLElement, Navigate>();
const ROW = "tr[data-followup-row-key]";
const SCOPE = "[data-followup-navigation]";
const HIDDEN = "[hidden],[inert],[aria-hidden='true']";

/** 跨入子表时由子表激活记录，父表继续维护自己的行与保存保护。 */
export function registerFollowupNavigation(root: HTMLElement, onNavigate: Navigate) {
  navigationScopes.set(root, onNavigate);
  return () => { navigationScopes.delete(root); };
}

function nestedRecordOrigin(target: Element, root: HTMLElement, rows: HTMLElement[]) {
  let origin = target.closest<HTMLElement>("tr");
  while (origin && root.contains(origin)) {
    const summary = origin.hasAttribute("data-followup-inline-details") ? origin.previousElementSibling : origin;
    if (summary && rows.includes(summary as HTMLElement)) return summary as HTMLElement;
    origin = origin.parentElement?.closest<HTMLElement>("tr") ?? null;
  }
  return null;
}

function parallelTableRow(summary: HTMLElement, direction: number) {
  const current = summary.closest("table");
  const detail = current?.parentElement?.closest("[data-followup-inline-details]") ?? null;
  const region = detail ?? current?.closest("main") ?? summary.ownerDocument.body;
  const tables = [...region.querySelectorAll<HTMLTableElement>("table")].filter(table =>
    (table.parentElement?.closest("[data-followup-inline-details]") ?? null) === detail
    && !table.closest(HIDDEN) && [...table.querySelectorAll<HTMLElement>(ROW)].some(row => row.closest("table") === table && !row.closest(HIDDEN)));
  const index = current ? tables.indexOf(current) : -1;
  const table = index < 0 ? undefined : tables[index + direction];
  const rows = table ? [...table.querySelectorAll<HTMLElement>(ROW)].filter(row => row.closest("table") === table && !row.closest(HIDDEN)) : [];
  return rows.find(row => row.dataset.followupActive === "true") ?? rows[0];
}

export function navigateFollowupTable(event: KeyboardEvent<HTMLElement>, onNavigate: Navigate, mode: FollowupNavigationMode = "records") {
  const context = followupKeyContext(event);
  const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
  const command = followupKeyboardCommand({ ...event, isComposing: composing }, context);
  const siblingMove = event.altKey && !event.shiftKey && (event.key === "ArrowDown" || event.key === "ArrowUp");
  const tableMove = event.key === "Tab" && !event.altKey;
  if (context.overlay || context.editing || event.defaultPrevented || composing || event.repeat || event.ctrlKey || event.metaKey
    || command?.type !== "move" && !siblingMove && !tableMove) return;
  const target = event.target as Element;
  // 表单、链接及按钮保留原生 Tab 顺序；行或详情背景用 Tab 切换并列表格。
  if (tableMove && target.closest("button,a,input,textarea,select,[contenteditable],[role='checkbox'],[role='tab']")) return;
  let root = event.currentTarget;
  let ancestor = root.parentElement?.closest<HTMLElement>(SCOPE);
  while (ancestor) { root = ancestor; ancestor = root.parentElement?.closest<HTMLElement>(SCOPE); }
  const rows = [...root.querySelectorAll<HTMLElement>(ROW)].filter(row => !row.closest(HIDDEN));
  const summary = nestedRecordOrigin(target, root, rows);
  if (!summary) return;
  if (siblingMove && mode !== "tree" && root.dataset.followupNavigation !== "tree"
    && !rows.some(row => row.closest("table") !== summary.closest("table"))) return;
  const direction = tableMove ? event.shiftKey ? -1 : 1 : event.key === "ArrowDown" ? 1 : -1;
  const siblings = siblingMove ? rows.filter(row => row.parentElement === summary.parentElement) : rows;
  const next = tableMove ? parallelTableRow(summary, direction) : siblings[siblings.indexOf(summary) + direction];
  if (tableMove && !next) return;
  event.preventDefault();
  event.stopPropagation();
  if (summary.getAttribute("aria-busy") === "true" || !next || next.getAttribute("aria-busy") === "true") return;
  const sourceScope = summary.closest<HTMLElement>(SCOPE) ?? event.currentTarget;
  const destinationScope = next.closest<HTMLElement>(SCOPE) ?? event.currentTarget;
  const navigate = destinationScope === event.currentTarget ? onNavigate : navigationScopes.get(destinationScope);
  if (!navigate) return;
  const currentKey = summary.dataset.followupRowKey!;
  const leave = sourceScope === event.currentTarget ? onNavigate : navigationScopes.get(sourceScope);
  if (sourceScope !== destinationScope && !leave?.(currentKey)) return;
  if (!navigate(next.dataset.followupRowKey!)) return;
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
}
