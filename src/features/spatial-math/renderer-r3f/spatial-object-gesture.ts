/** 对象手势接管显示帧，不冒充 Orbit 的开始／结束事件。 */
export const SPATIAL_OBJECT_GESTURE_START = "mathin:spatial-object-gesture-start";
export function beginSpatialObjectGesture(canvas: HTMLCanvasElement) {
  canvas.dispatchEvent(new Event(SPATIAL_OBJECT_GESTURE_START));
}
