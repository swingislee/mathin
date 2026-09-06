import { PerspectiveCamera, type Camera, type Object3D, type Vector3 } from "three";
import { ArcballControls } from "three/addons/controls/ArcballControls.js";

// 锁定的 Three.js 实现中，平移会更新 gizmo 中心，但不会回写公开 target。
// 将这项版本适配集中在此处，由平移后切换视角的合同测试覆盖。
export class SpatialArcballControls extends ArcballControls {
  declare readonly target: Vector3;
  declare private readonly _currentTarget: Vector3;
  declare private readonly _gizmos: Object3D;
  declare private readonly _upState: Vector3;
  declare minFov: number;
  declare maxFov: number;

  get rotationTarget(): Vector3 {
    return this._gizmos.position;
  }

  setRotationTarget(target: { readonly x: number; readonly y: number; readonly z: number }) {
    this.target.set(target.x, target.y, target.z);
    this._currentTarget.copy(this.target);
    this._gizmos.position.copy(this.target);
    this._gizmos.updateMatrix();
  }

  syncFromCamera() {
    // Arcball 将 _upState 乘以相机四元数，基准必须是相机局部 Y。
    // 顶/底视角书签使用世界空间 up，直接沿用会再转一次而产生意外侧翻。
    this._upState.set(0, 1, 0);
    // 投影由显式视角按钮管理，鼠标组合键和三指手势保持既定视场角。
    if (this.object instanceof PerspectiveCamera) {
      this.minFov = this.maxFov = this.object.fov;
    }
    this.object.updateMatrix();
    this.update();
  }

  resize() {
    this.setTbRadius(this.radiusFactor);
  }
}

/** 起点锚定的自由旋转；松手即停，动画和可选吸附由共享相机层管理。 */
export function createSpatialArcballControls(camera: Camera, element: HTMLElement): SpatialArcballControls {
  const controls = new SpatialArcballControls(camera, element);
  controls.enableAnimations = false;
  controls.enableFocus = false;
  controls.cursorZoom = false;
  controls.rotateSpeed = 1;
  controls.minDistance = 0.1;
  controls.minZoom = 0.1;
  controls.maxZoom = 20;
  controls.setTbRadius(0.85);
  controls.setGizmosVisible(false);
  controls.unsetMouseAction("WHEEL", "SHIFT");
  controls.unsetMouseAction(1, "SHIFT");
  controls.syncFromCamera();
  return controls;
}
