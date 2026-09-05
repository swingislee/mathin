interface EntryKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

/** 数字输入保留给表单；编辑文字时用 Alt + 数字切换结果。 */
export function inlineEntryCommand(event: EntryKeyEvent, editingText = false) {
  if (event.repeat || event.isComposing || event.shiftKey) return null;
  if (event.ctrlKey || event.metaKey) {
    return event.key === "Enter" && !event.altKey ? { type: "submit" as const } : null;
  }
  if (event.key === "Escape" && !event.altKey) return { type: "close" as const };
  if (/^[1-9]$/.test(event.key) && (!editingText || event.altKey)) {
    return { type: "choice" as const, index: Number(event.key) - 1 };
  }
  return null;
}
