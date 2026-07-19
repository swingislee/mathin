import type { PageDoc } from "./schema";

/** P6-6 分类报告携带的统一仿射；节点 geometry 与 path points 必须共同变换。 */
/**
 * 4:3 派生用的轴向仿射。早期报告只有 `scale`；保留它以兼容已导出的包，
 * 而 H5 容器可显式给出 scaleX / scaleY 来填满 4:3 舞台。
 */
export type Adapt43Affine = {
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  translateX: number;
  translateY: number;
};

/** page-doc 的节点是本地坐标树；F 类把原节点置于保留 16:9 比例的内容层。 */
export type Adapt43NodeTransformScope = "all" | "root" | "frame";

function axes(affine: Adapt43Affine): { scaleX: number; scaleY: number } {
  const scaleX = affine.scaleX ?? affine.scale;
  const scaleY = affine.scaleY ?? affine.scale;
  if (!Number.isFinite(scaleX) || scaleX! <= 0 || !Number.isFinite(scaleY) || scaleY! <= 0) {
    throw new Error("INVALID_4X3_AFFINE");
  }
  return { scaleX: scaleX as number, scaleY: scaleY as number };
}

function transformPoint(x: number, y: number, affine: Adapt43Affine): [number, number] {
  const { scaleX, scaleY } = axes(affine);
  return [x * scaleX + affine.translateX, y * scaleY + affine.translateY];
}

/**
 * 生成不可变的 4:3 page-doc-v1 快照。不会触碰资源 bindingKey；背景资源的
 * 派生版本由 page_asset_bindings 的 pin + release snapshot 单独决定。
 */
export function derive43PageDoc(doc: PageDoc, affine: Adapt43Affine, nodeTransformScope: Adapt43NodeTransformScope = "all"): PageDoc {
  if (!Number.isFinite(affine.translateX) || !Number.isFinite(affine.translateY)) {
    throw new Error("INVALID_4X3_AFFINE");
  }
  const { scaleX, scaleY } = axes(affine);
  if (nodeTransformScope === "frame") {
    const template = doc.nodes[0];
    if (!template) throw new Error("CONTENT_FRAME_REQUIRES_NODE");
    return {
      ...doc,
      canvas: { ...doc.canvas, width: 960, height: 720 },
      nodes: [{
        ...template,
        id: "mathin-adapt-4x3-content-frame",
        nodePath: "$.mathinAdapt43ContentFrame",
        sourceType: "mathin:adapt-4x3-content-frame",
        sourceResourceId: null,
        adapter: "group",
        name: null,
        supported: true,
        visible: true,
        interactive: false,
        zIndex: 0,
        order: 0,
        crop: null,
        transform: { x: 0, y: 90, width: 1280, height: 720, rotation: 0, scaleX: 0.75, scaleY: 0.75, anchorX: 0, anchorY: 0, opacity: 1, flipX: false, flipY: false, clip: false },
        resources: [],
        content: null,
        children: doc.nodes,
      }],
    };
  }
  const mapNode = (node: PageDoc["nodes"][number], depth: number): PageDoc["nodes"][number] => {
    const shouldTransform = nodeTransformScope === "all" || depth === 0;
    const [x, y] = shouldTransform ? transformPoint(node.transform.x, node.transform.y, affine) : [node.transform.x, node.transform.y];
    return {
      ...node,
      transform: { ...node.transform, x, y, width: shouldTransform ? node.transform.width * scaleX : node.transform.width, height: shouldTransform ? node.transform.height * scaleY : node.transform.height },
      children: node.children.map((child) => mapNode(child, depth + 1)),
    };
  };
  return {
    ...doc,
    canvas: { ...doc.canvas, width: 960, height: 720 },
    nodes: doc.nodes.map((node) => mapNode(node, 0)),
    interactions: doc.interactions.map((interaction) => {
      if (!interaction.path) return interaction;
      const points = interaction.path.points.map((point, index, all) => {
        const [x, y] = transformPoint(index % 2 === 0 ? point : all[index - 1]!, index % 2 === 0 ? all[index + 1]! : point, affine);
        return index % 2 === 0 ? x : y;
      });
      return { ...interaction, path: { ...interaction.path, points } };
    }),
  };
}
