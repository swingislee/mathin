import { describe, expect, it, vi } from "vitest";
import { createTilePointerDragController, type TilePointerDragState } from "../src/features/school/tile-pointer-drag";

function events(pointerId = 1) {
  let captured = false;
  const target = {
    setPointerCapture: vi.fn(() => { captured = true; }),
    hasPointerCapture: vi.fn(() => captured),
    releasePointerCapture: vi.fn(() => { captured = false; }),
  };
  return {
    target,
    start: { pointerId, clientX: 10, clientY: 20, button: 0, isPrimary: true, defaultPrevented: false,
      currentTarget: target, preventDefault: vi.fn(), stopPropagation: vi.fn() },
    point: (clientX: number, clientY: number, id = pointerId) => ({ pointerId: id, clientX, clientY, preventDefault: vi.fn() }),
  };
}

describe("shared tile pointer drag", () => {
  it("preserves an ordinary click until movement reaches the threshold", () => {
    const drag = createTilePointerDragController<string>();
    const event = events();
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const onChange = vi.fn();
    const callbacks = { onStart, onEnd, onChange };
    expect(drag.begin(event.start, "student", callbacks)).toBe(true);
    drag.move(event.point(12, 22), callbacks);
    drag.end(event.point(12, 22), callbacks);
    const click = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    drag.onClickCapture(click);
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(event.start.preventDefault).not.toHaveBeenCalled();
    expect(click.preventDefault).not.toHaveBeenCalled();
    expect(event.target.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("previews after threshold and ends with the actual release coordinates exactly once", () => {
    const drag = createTilePointerDragController<{ studentId: string }>();
    const event = events();
    const onStart = vi.fn();
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const onCancel = vi.fn();
    const callbacks = { onStart, onMove, onEnd, onCancel };
    drag.begin(event.start, { studentId: "student" }, callbacks);
    drag.move(event.point(13, 24), callbacks);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenLastCalledWith(expect.objectContaining({ data: { studentId: "student" }, deltaX: 3, deltaY: 4 }));
    drag.end(event.point(250, 100), callbacks);
    drag.end(event.point(250, 100), callbacks);
    drag.cancel(callbacks, 1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(expect.objectContaining({ clientX: 250, clientY: 100, deltaX: 240, deltaY: 80 }));
    expect(onCancel).not.toHaveBeenCalled();
    const keyboardClick = { detail: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    drag.onClickCapture(keyboardClick);
    expect(keyboardClick.preventDefault).not.toHaveBeenCalled();
    const click = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    drag.onClickCapture(click);
    drag.onClickCapture(click);
    expect(click.preventDefault).toHaveBeenCalledTimes(1);
    expect(click.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("captures and releases the actual child button while leaving a short click intact", () => {
    const drag = createTilePointerDragController<string>();
    const wrapper = events();
    const button = events();
    const onEnd = vi.fn();
    const callbacks = { onEnd };
    expect(drag.begin(wrapper.start, "student", callbacks, button.target)).toBe(true);
    expect(button.target.setPointerCapture).toHaveBeenCalledWith(1);
    expect(wrapper.target.setPointerCapture).not.toHaveBeenCalled();
    drag.end(wrapper.point(11, 21), callbacks);
    expect(button.target.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(wrapper.target.releasePointerCapture).not.toHaveBeenCalled();
    expect(wrapper.start.preventDefault).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    const click = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    drag.onClickCapture(click);
    expect(click.preventDefault).not.toHaveBeenCalled();
  });

  it("cancels without dropping and ignores another pointer during the session", () => {
    const drag = createTilePointerDragController<string>();
    const event = events();
    const onStart = vi.fn();
    const onCancel = vi.fn();
    const onEnd = vi.fn();
    const callbacks = { onStart, onCancel, onEnd };
    drag.begin(event.start, "student", callbacks);
    drag.move(event.point(100, 200, 2), callbacks);
    drag.end(event.point(100, 200, 2), callbacks);
    expect(onStart).not.toHaveBeenCalled();
    drag.move(event.point(100, 200), callbacks);
    drag.cancel(callbacks, 2);
    expect(onCancel).not.toHaveBeenCalled();
    drag.cancel(callbacks, 1);
    drag.end(event.point(100, 200), callbacks);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith(expect.objectContaining({ clientX: 100, clientY: 200 }));
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("retains the tile editor's immediate start and releases capture when unmounted", () => {
    const drag = createTilePointerDragController<{ mode: "move" | "resize" }>();
    const event = events();
    const snapshots: Array<TilePointerDragState<{ mode: "move" | "resize" }> | null> = [];
    const callbacks = { threshold: 0, onChange: (state: typeof snapshots[number]) => snapshots.push(state), onEnd: vi.fn(), onCancel: vi.fn() };
    drag.begin(event.start, { mode: "resize" }, callbacks);
    expect(snapshots[0]).toMatchObject({ data: { mode: "resize" }, deltaX: 0, deltaY: 0 });
    expect(event.start.preventDefault).toHaveBeenCalledTimes(1);
    drag.dispose();
    expect(event.target.releasePointerCapture).toHaveBeenCalledWith(1);
    drag.end(event.point(100, 200), callbacks);
    expect(callbacks.onEnd).not.toHaveBeenCalled();
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });

  it("rejects secondary buttons and duplicate starts without replacing the active payload", () => {
    const drag = createTilePointerDragController<string>();
    const event = events();
    const onEnd = vi.fn();
    expect(drag.begin({ ...event.start, button: 2 }, "wrong", { onEnd })).toBe(false);
    expect(drag.begin({ ...event.start, isPrimary: false }, "wrong", { onEnd })).toBe(false);
    expect(drag.begin(event.start, "original", { threshold: 0, onEnd })).toBe(true);
    expect(drag.begin(event.start, "replacement", { threshold: 0, onEnd })).toBe(false);
    drag.end(event.point(100, 200), { onEnd });
    expect(onEnd).toHaveBeenCalledWith(expect.objectContaining({ data: "original" }));
  });
});
