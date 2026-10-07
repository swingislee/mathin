export type StudentLabelDirection = "previous" | "next" | "left" | "right" | "up" | "down";

export function studentLabelDirection(key: string): StudentLabelDirection | null {
  switch (key) {
    case "ArrowLeft": return "left";
    case "ArrowRight": return "right";
    case "ArrowUp": return "up";
    case "ArrowDown": return "down";
    default: return null;
  }
}

export function studentLabelTriggers(root: ParentNode, current?: HTMLButtonElement | null): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("[data-student-label-trigger]:not(:disabled)"))
    .filter(button => button.getClientRects().length > 0
      && (button === current || button.getAttribute("aria-disabled") !== "true")
      && !button.closest('[hidden], [inert], [aria-hidden="true"]'));
}

/** Horizontal keys stay within a class; vertical keys keep the nearest student column. */
export function adjacentStudentLabel(current: HTMLButtonElement, direction: StudentLabelDirection): HTMLButtonElement | null {
  const scope = current.closest("[data-student-label-scope]");
  if (!scope) return null;
  const controls = studentLabelTriggers(scope, current).filter(button => button.closest("[data-student-label-scope]") === scope);
  const index = controls.indexOf(current);
  if (index < 0) return null;
  if (direction === "previous" || direction === "next") return controls[index + (direction === "next" ? 1 : -1)] ?? null;

  const rowFor = (button: HTMLButtonElement) => button.closest("tr[data-placement-record], li");
  const row = rowFor(current);
  const step = direction === "right" || direction === "down" ? 1 : -1;
  if (!row || row.tagName === "LI") return controls[index + step] ?? null;
  if (direction === "left" || direction === "right") {
    const classmates = controls.filter(button => rowFor(button) === row);
    return classmates[classmates.indexOf(current) + step] ?? null;
  }
  const rows = [...new Set(controls.map(rowFor).filter(Boolean))];
  const nextRow = rows[rows.indexOf(row) + step];
  if (!nextRow) return null;
  const centerX = (button: HTMLButtonElement) => {
    const rect = (button.closest("[data-student-label-entry]") ?? button).getBoundingClientRect();
    return rect.left + rect.width / 2;
  };
  const originX = centerX(current);
  return controls.filter(button => rowFor(button) === nextRow)
    .sort((a, b) => Math.abs(centerX(a) - originX) - Math.abs(centerX(b) - originX))[0] ?? null;
}

export function focusStudentLabel(target: HTMLButtonElement | null): boolean {
  if (!target?.isConnected || target.disabled) return false;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

export function openStudentLabelDetails(element: HTMLElement): boolean {
  const details = element.closest("[data-student-label-entry]")
    ?.querySelector<HTMLElement>("[data-student-label-details] button, a[data-student-label-details]");
  if (!details) return false;
  details.click();
  return true;
}
