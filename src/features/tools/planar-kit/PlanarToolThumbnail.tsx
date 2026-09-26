import { planarScene } from "./scene-registry";
import type { PlanarDrawingApi } from "./types";

const inert: PlanarDrawingApi = { locale: "zh", selected: null, editable: false, bind: () => ({
  role: "button", tabIndex: -1, "aria-label": "", "aria-disabled": true, "aria-pressed": false,
}) };
/** 服务端目录图复用实际数学模型，无第二套示意图或客户端工作台。 */
export function PlanarToolThumbnail({ sceneId }: { sceneId: string }) {
  const scene = planarScene(sceneId), state = scene.create();
  return <svg viewBox="80 95 800 530" className="size-full" aria-hidden pointerEvents="none">
    {scene.draw({ ...state, flags: { ...state.flags, measures: false, areas: false, original: false, grid: false } }, inert)}
  </svg>;
}
