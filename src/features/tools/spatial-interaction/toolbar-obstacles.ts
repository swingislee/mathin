import { InstancedMesh, Matrix4, Mesh, Vector3, type Camera, type Object3D } from "three";
import type { SpatialScreenRect } from "./toolbar-placement";

const PADDING = 4;
const DOM_OBSTACLES = '[data-cube-canvas-panel], [role="toolbar"], [aria-live], [data-spatial-toolbar-avoid]';
const SVG_CONTENT = '[data-spatial-toolbar-content] :is(path, rect, polygon, polyline, circle, ellipse, line, text, image)';

/** 只读取教学实体与标签；地面、网格、旋转悬停预告不占据工具条空位。 */
export function spatialSceneObstacles(scene: Object3D, camera: Camera, size: { width: number; height: number }): SpatialScreenRect[] {
  const result: SpatialScreenRect[] = [], transform = new Matrix4(), instance = new Matrix4(), point = new Vector3();
  scene.updateMatrixWorld();
  const visit = (object: Object3D, protectedContent: boolean) => {
    if (!object.visible) return;
    const protect = protectedContent || object.userData.spatialToolbarObstacle === true || typeof object.userData.spatialObjectId === "string";
    if (protect && object instanceof Mesh && (Array.isArray(object.material) ? object.material : [object.material]).some((material) => material.visible && material.opacity > .005)) {
      const geometry = object.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      if (bounds && !bounds.isEmpty()) for (let i = 0; i < (object instanceof InstancedMesh ? object.count : 1); i++) {
        transform.copy(object.matrixWorld);
        if (object instanceof InstancedMesh) { object.getMatrixAt(i, instance); transform.multiply(instance); }
        const rect = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
        let front = 0, behind = 0;
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          point.set(x, y, z).applyMatrix4(transform).applyMatrix4(camera.matrixWorldInverse);
          if (point.z >= 0) { behind++; continue; }
          point.applyMatrix4(camera.projectionMatrix);
          const sx = (point.x + 1) * size.width / 2, sy = (1 - point.y) * size.height / 2;
          if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
          front++; rect.left = Math.min(rect.left, sx); rect.right = Math.max(rect.right, sx);
          rect.top = Math.min(rect.top, sy); rect.bottom = Math.max(rect.bottom, sy);
        }
        // 近距离穿过相机的物体可能覆盖整个视野，宁可暂收快捷条。
        if (front && behind) result.push({ left: 0, top: 0, right: size.width, bottom: size.height });
        else if (front) result.push({ left: rect.left - PADDING, top: rect.top - PADDING, right: rect.right + PADDING, bottom: rect.bottom + PADDING });
      }
    }
    object.children.forEach((child) => visit(child, protect));
  };
  visit(scene, false);
  return result;
}

/** 范围限定在当前工作台；DOM 坐标统一换算成画布的屏幕像素。 */
export function toolbarDomObstacles(scope: Element, toolbar: HTMLElement, origin: { left: number; top: number }, overlay?: Element): SpatialScreenRect[] {
  const candidates = new Set(scope.querySelectorAll(`${DOM_OBSTACLES}, ${SVG_CONTENT}`));
  // drei Html 也承载含换行的标签和截面 SVG；按实际文字容器／图元取边界。
  overlay?.querySelectorAll("*").forEach((node) => {
    const text = node instanceof HTMLElement && [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
    const graphic = node.namespaceURI === "http://www.w3.org/2000/svg" && node.matches("path, rect, polygon, polyline, circle, ellipse, line, text, image");
    if (text || graphic) candidates.add(node);
  });
  const result: SpatialScreenRect[] = [];
  for (const node of candidates) {
    if (toolbar.contains(node) || node.contains(toolbar) || node.closest("defs, clipPath, mask, pattern")) continue;
    const rect = node.getBoundingClientRect();
    if ((!rect.width && !rect.height) || ![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)) continue;
    let visible = true;
    for (let ancestor: Element | null = node; ancestor && ancestor !== scope.parentElement; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") { visible = false; break; }
    }
    if (visible) result.push({ left: rect.left - origin.left - PADDING, top: rect.top - origin.top - PADDING,
      right: rect.right - origin.left + PADDING, bottom: rect.bottom - origin.top + PADDING });
  }
  return result;
}

/** 面板开合、文字/字体变化也触发布局；忽略工具条自身定位，避免反馈循环。 */
export function watchToolbarLayout(scope: Element, excluded: Element, refresh: () => void) {
  const resize = new ResizeObserver(refresh);
  resize.observe(scope);
  let observed = new Set<Element>();
  const observeContent = () => {
    const next = new Set([...scope.querySelectorAll(DOM_OBSTACLES)].filter((node) => !excluded.contains(node)));
    observed.forEach((node) => { if (!next.has(node)) resize.unobserve(node); });
    next.forEach((node) => { if (!observed.has(node)) resize.observe(node); });
    observed = next;
  };
  observeContent();
  const mutation = new MutationObserver((records) => {
    // 部分投影注解每帧重写相同属性；等值写入不产生新的 demand 帧。
    const changed = records.some((record) => !excluded.contains(record.target) && (record.type !== "attributes"
      || (record.target as Element).getAttribute(record.attributeName!) !== record.oldValue));
    if (!changed) return;
    observeContent(); refresh();
  });
  mutation.observe(scope, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true });
  document.fonts?.addEventListener("loadingdone", refresh);
  return () => { resize.disconnect(); mutation.disconnect(); document.fonts?.removeEventListener("loadingdone", refresh); };
}
