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
export function navigateFollowupTable(event: KeyboardEvent<HTMLElement>, onNavigate: (key: string) => boolean) {
  const command = followupKeyboardCommand({ ...event, isComposing: event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 }, followupKeyContext(event));
  if (command?.type !== "move") return;
  const origin = (event.target as Element).closest("tr");
  const summary = origin?.hasAttribute("data-followup-inline-details") ? origin.previousElementSibling : origin;
  const currentKey = summary?.getAttribute("data-followup-row-key");
  if (!currentKey) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("tr[data-followup-row-key]")];
  const keys = rows.map((row) => row.dataset.followupRowKey!);
  const nextKey = adjacentFollowupKey(keys, currentKey, command.direction);
  event.preventDefault();
  event.stopPropagation();
  if (summary?.getAttribute("aria-busy") === "true" || !nextKey || !onNavigate(nextKey)) return;
  const next = rows[keys.indexOf(nextKey)];
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
}
