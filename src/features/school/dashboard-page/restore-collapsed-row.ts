/** 折叠布局提交后回到当前层的摘要，避开固定表头并保留横向阅读位置。 */
export function restoreCollapsedRow(summary: HTMLElement | null | undefined, detailsId?: string) {
  const view = summary?.ownerDocument.defaultView;
  if (!summary || !view || !summary.isConnected || summary.closest("[hidden],[inert]")) return;

  const controls = detailsId ?? summary.getAttribute("aria-controls");
  const triggers = [...summary.querySelectorAll<HTMLButtonElement>("button[aria-expanded]:not(:disabled)")]
    .filter(button => button.closest("tr") === summary);
  const trigger = triggers.find(button => controls && button.getAttribute("aria-controls")?.split(/\s+/).includes(controls)) ?? triggers[0];
  const target = trigger ?? summary;
  if (target === summary && !summary.hasAttribute("tabindex")) summary.tabIndex = -1;
  target.focus({ preventScroll: true });

  view.requestAnimationFrame(() => {
    if (!summary.isConnected || summary.closest("[hidden],[inert]")
      || summary.ownerDocument.activeElement !== target
      || summary.getAttribute("aria-expanded") === "true" || summary.getAttribute("data-followup-expanded") === "true") return;

    let topInset = 8;
    const horizontal: [HTMLElement, number][] = [];
    for (let ancestor: HTMLElement | null = summary.parentElement; ancestor; ancestor = ancestor.parentElement) {
      horizontal.push([ancestor, ancestor.scrollLeft]);
      if (ancestor.tagName !== "TABLE") continue;
      const header = (ancestor as HTMLTableElement).tHead;
      if (!header) continue;
      const sticky = [header, ...header.querySelectorAll<HTMLElement>("tr,th")]
        .filter(node => view.getComputedStyle(node).position === "sticky");
      topInset += Math.max(0, ...sticky.map(node => node.getBoundingClientRect().height));
    }
    const chrome = summary.closest("[data-dashboard-canvas]")?.querySelector<HTMLElement>("[data-dashboard-page-chrome]");
    if (chrome && view.getComputedStyle(chrome).position === "sticky") topInset += chrome.getBoundingClientRect().height;

    const margin = summary.style.scrollMarginTop;
    summary.style.scrollMarginTop = `${Math.max(topInset, parseFloat(view.getComputedStyle(summary).scrollMarginTop) || 0)}px`;
    summary.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    summary.style.scrollMarginTop = margin;
    for (const [ancestor, left] of horizontal) {
      if (ancestor.scrollLeft !== left) ancestor.scrollLeft = left;
    }
  });
}
