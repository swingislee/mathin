"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { newId } from "@/lib/uuid";
import { CLASSROOM_PAGING_PROTOCOL, classroomPagingDirection, pagingDialogIsOpen, pagingTargetIsEditing } from "./classroom-paging";

/** 教师端统一接收窗口与已登记课件 iframe 的翻页键；翻页继续走原课堂事件流。 */
export function useClassroomPaging({
  enabled,
  rootRef,
  onPage,
}: {
  enabled: boolean;
  rootRef: RefObject<HTMLElement | null>;
  onPage: (direction: -1 | 1) => void;
}) {
  const onPageRef = useRef(onPage);
  useLayoutEffect(() => { onPageRef.current = onPage; }, [onPage]);

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    const doc = root.ownerDocument;
    const host = doc.defaultView!;
    const frames = new Map<HTMLIFrameElement, string>();
    const configure = (frame: HTMLIFrameElement, active: boolean) => {
      let token = frames.get(frame);
      if (!token) { token = newId(); frames.set(frame, token); }
      frame.contentWindow?.postMessage({ protocol: CLASSROOM_PAGING_PROTOCOL, type: "configure", enabled: active, token }, "*");
    };
    const scan = () => {
      for (const frame of frames.keys()) if (!root.contains(frame)) frames.delete(frame);
      for (const frame of root.querySelectorAll("iframe")) if (!frames.has(frame)) configure(frame, true);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const direction = classroomPagingDirection(event, pagingTargetIsEditing(event.target), pagingDialogIsOpen(doc));
      if (!direction) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onPageRef.current(direction);
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.protocol !== CLASSROOM_PAGING_PROTOCOL) return;
      const frame = Array.from(root.querySelectorAll("iframe")).find((candidate) => candidate.contentWindow === event.source);
      if (!frame) return;
      if (data.type === "hello") { configure(frame, true); return; }
      if (data.type !== "key" || data.token !== frames.get(frame) || doc.activeElement !== frame || pagingDialogIsOpen(doc)) return;
      const direction = classroomPagingDirection({ key: data.key }, false, false);
      if (direction) onPageRef.current(direction);
    };
    const onLoad = (event: Event) => {
      if (event.target instanceof HTMLIFrameElement && root.contains(event.target)) configure(event.target, true);
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener("load", onLoad, true);
    host.addEventListener("keydown", keydown, true);
    host.addEventListener("message", receive);
    return () => {
      observer.disconnect();
      root.removeEventListener("load", onLoad, true);
      host.removeEventListener("keydown", keydown, true);
      host.removeEventListener("message", receive);
      for (const frame of frames.keys()) configure(frame, false);
    };
  }, [enabled, rootRef]);
}
