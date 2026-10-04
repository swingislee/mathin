import type { PlanarState } from "../../src/features/tools/planar-kit/contract";
import { addNetworkPoint, appendNetworkVisit, continueNetworkStroke, createNetworkState, liftNetworkPen, recordNetworkFigure, removeNetworkRecord, rotateNetworkComponent, setNetworkField, setNetworkFlag, tapNetworkTarget, translateNetworkComponent } from "../../src/features/tools/plane-network/model";

/** 新操作的终点继续走原 v2 TS / SQL 合同，不增加显示参数或新的场景版本。 */
export function planeNetworkCases() {
  const cases: { label: string; accepted: boolean; scene: { toolId: string; contentVersion: string; payload: { title: string; initial: PlanarState } } }[] = [];
  const add = (label: string, state: PlanarState, accepted = true) => {
    const toolId = state.sceneId === "47-create" ? "plane-patterns" : "plane-graph-path";
    cases.push({ label, accepted, scene: { toolId, contentVersion: `${toolId}-lesson-v2`, payload: { title: "Precise network operations", initial: state } } });
  };
  const counted = recordNetworkFigure(tapNetworkTarget(tapNetworkTarget(createNetworkState("47-create"), "node.0"), "node.1"));
  const selectedNode = tapNetworkTarget(setNetworkFlag(counted, "edit", true), "node.0"), selectedEdge = tapNetworkTarget(selectedNode, "edge.0");
  add("count-v2-existing", counted);
  add("fractional-node", setNetworkField(selectedNode, "nodeX", 290.12345));
  add("fractional-edge-endpoint", setNetworkField(selectedEdge, "edgeBY", 343.765));
  add("precise-edge-length", setNetworkField(selectedEdge, "edgeLength", 12.125));
  add("precise-edge-angle", setNetworkField(selectedEdge, "edgeAngle", 137.5));
  add("component-move", translateNetworkComponent(selectedNode, "node.0", { x: 73.125, y: -98.75 }));
  add("component-rotation", rotateNetworkComponent(selectedNode, "node.0", -123.75));
  add("component-center", setNetworkField(selectedNode, "componentX", 512.0625));
  add("one-observation-removed", removeNetworkRecord(counted, 1));
  let traced = addNetworkPoint(createNetworkState("52-create"), { x: 440, y: 360 });
  traced = appendNetworkVisit(appendNetworkVisit(traced, 0), 2);
  traced = appendNetworkVisit(appendNetworkVisit(liftNetworkPen(traced), 2), 1);
  add("two-numbered-strokes", traced); add("first-stroke-removed", removeNetworkRecord(traced, 1));
  add("current-stroke-removed", removeNetworkRecord(traced, 2)); add("continue-previous-stroke", continueNetworkStroke(traced, 1));
  add("traced-component-rotation", rotateNetworkComponent(traced, "node.0", 37.75));
  add("traced-component-move", translateNetworkComponent(traced, "node.0", { x: -25.125, y: 97.875 }));
  add("hidden-records-still-saved", setNetworkFlag(traced, "highlights", false));
  add("unknown-precision-cache", { ...selectedNode, params: { ...selectedNode.params, nodeX: 1 } }, false);
  add("unknown-component-cache", { ...selectedNode, params: { ...selectedNode.params, componentAngle: 30 } }, false);
  add("unknown-record-selection", { ...traced, params: { ...traced.params, selectedRecord: 1 } }, false);
  add("stale-current-stroke", { ...removeNetworkRecord(traced, 2), params: { ...removeNetworkRecord(traced, 2).params, currentStroke: 2 } }, false);
  return cases;
}
