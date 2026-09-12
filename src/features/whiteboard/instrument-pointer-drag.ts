interface InstrumentPointerStart {
  pointerId: number;
  currentTarget: SVGElement;
}

/** 尺规拖动由按下的指针持有；松开、失去捕获或离开页面时移除整组监听。 */
export function trackInstrumentPointer(start: InstrumentPointerStart, {
  onMove, onFinish,
}: {
  onMove: (event: PointerEvent) => void;
  onFinish: (cancelled: boolean) => void;
}): () => void {
  const { pointerId, currentTarget: target } = start;
  const owner = target.ownerDocument;
  const host = owner?.defaultView ?? window;
  let active = true;

  const finish = (cancelled: boolean) => {
    if (!active) return;
    active = false;
    host.removeEventListener("pointermove", move, true);
    host.removeEventListener("pointerup", up, true);
    host.removeEventListener("pointercancel", cancelPointer, true);
    host.removeEventListener("blur", cancel);
    host.removeEventListener("pagehide", cancel);
    owner?.removeEventListener("visibilitychange", visibility);
    target.removeEventListener("lostpointercapture", lostCapture);
    try {
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    } catch {
      // 节点卸载或浏览器已释放捕获时，仍完成本地收尾。
    }
    onFinish(cancelled);
  };
  const move = (event: PointerEvent) => {
    if (!active || event.pointerId !== pointerId) return;
    if ((event.pointerType === "mouse" || event.pointerType === "pen") && (event.buttons & 1) === 0) {
      // 松开事件遗漏时保留最后一次按住移动的结果，不采用悬停坐标。
      finish(false);
      return;
    }
    onMove(event);
  };
  const up = (event: PointerEvent) => {
    if (!active || event.pointerId !== pointerId) return;
    onMove(event);
    finish(false);
  };
  const cancelPointer = (event: PointerEvent) => { if (event.pointerId === pointerId) finish(true); };
  const lostCapture = (event: PointerEvent) => {
    // 子节点的隐式捕获转交给手柄时也会冒泡；只处理本手柄真正失去捕获。
    if (event.target === target) cancelPointer(event);
  };
  const cancel = () => finish(true);
  const visibility = () => { if (owner?.visibilityState === "hidden") cancel(); };

  host.addEventListener("pointermove", move, { capture: true, passive: false });
  host.addEventListener("pointerup", up, true);
  host.addEventListener("pointercancel", cancelPointer, true);
  host.addEventListener("blur", cancel);
  host.addEventListener("pagehide", cancel);
  owner?.addEventListener("visibilitychange", visibility);
  target.addEventListener("lostpointercapture", lostCapture);
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // 不支持捕获的输入源继续由窗口捕获监听和按键状态结束拖动。
  }
  return cancel;
}
