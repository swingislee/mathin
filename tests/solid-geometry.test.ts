import { describe, expect, it } from "vitest";
import { Euler, Vector3 } from "three";
import { createSolidEntity, createSolidGeometryInitial, resizeSolidEntity, solidDimensionKeys, solidEntitySchema, solidGeometryInitial, solidGeometryInitialSchema, solidGeometrySnapshot, solidGeometrySnapshotSchema, solidGeometryToolSchema, SOLID_GEOMETRY_VERSION, SOLID_KINDS } from "@/features/tools/solid-geometry/solid-geometry-contract";
import { getSolidBounds, getSolidMeshData, getSolidMetrics, getSolidsFrame, getSolidTopology, rotateSolidPoint, solidLocalToWorld } from "@/features/tools/solid-geometry/solid-geometry";
import { interpolateSolidEntities } from "@/features/tools/solid-geometry/solid-geometry-motion";
import { moveSolidByDrag, solidDragState } from "@/features/tools/solid-geometry/solid-geometry-drag";

describe("solid geometry strict scene contract", () => {
  it("roundtrips a self-contained prepared scene and independent classroom state", () => {
    const initial = createSolidGeometryInitial();
    const scene = { toolId: "solid-geometry", contentVersion: SOLID_GEOMETRY_VERSION, payload: { title: "Compare solids", initial } };
    expect(solidGeometryToolSchema.parse(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
    const state = solidGeometrySnapshot(initial); state.entities[0].opacity = 0;
    expect(initial.entities[0].opacity).toBe(1);
    expect(solidGeometrySnapshotSchema.parse(state)).toEqual(state);
    expect(solidGeometryInitial(state)).not.toHaveProperty("cameraRevision");
  });
  it("validates size, cube equality, square bases and finite locations", () => {
    const cube = createSolidEntity("cube", "a");
    expect(solidEntitySchema.safeParse({ ...cube, dimensions: { ...cube.dimensions, height: 3 } }).success).toBe(false);
    const pyramid = createSolidEntity("square-pyramid", "p");
    expect(solidEntitySchema.safeParse({ ...pyramid, dimensions: { ...pyramid.dimensions, depth: 3 } }).success).toBe(false);
    expect(() => resizeSolidEntity(cube, "width", -1)).toThrow();
    expect(resizeSolidEntity(cube, "width", 3).dimensions).toMatchObject({ width: 3, height: 3, depth: 3 });
    expect(solidEntitySchema.safeParse({ ...cube, position: { x: NaN, y: 1, z: 0 } }).success).toBe(false);
    expect(solidEntitySchema.safeParse({ ...cube, opacity: 0 }).success).toBe(true);
    expect(solidDimensionKeys("sphere")).toEqual(["radius"]);
    expect(solidDimensionKeys("cylinder")).toEqual(["radius", "height"]);
  });
  it("rejects duplicates, dangling selections, invented features and arbitrary extension payloads", () => {
    const initial = createSolidGeometryInitial(), sphere = createSolidEntity("sphere", "sphere");
    expect(solidGeometryInitialSchema.safeParse({ ...initial, entities: [...initial.entities, initial.entities[0]] }).success).toBe(false);
    expect(solidGeometryInitialSchema.safeParse({ ...initial, selectedId: "missing" }).success).toBe(false);
    expect(solidGeometryInitialSchema.safeParse({ ...initial, extension: { arbitrary: true } }).success).toBe(false);
    const scene = { ...initial, entities: [sphere], selectedId: sphere.id };
    expect(solidGeometryInitialSchema.safeParse({ ...scene, feature: { entityId: sphere.id, kind: "vertex", id: "vertex-0" } }).success).toBe(false);
    expect(solidGeometryInitialSchema.safeParse({ ...scene, feature: { entityId: sphere.id, kind: "edge", id: "rim-top" } }).success).toBe(false);
    expect(solidGeometryInitialSchema.safeParse({ ...scene, feature: { entityId: sphere.id, kind: "face", id: "surface" } }).success).toBe(true);
  });
});
describe("true solid topology and geometry", () => {
  it.each([["cube", 6, 12, 8], ["cuboid", 6, 12, 8], ["triangular-prism", 5, 9, 6], ["square-pyramid", 5, 8, 5]] as const)("%s has semantic faces/edges/vertices, not triangle counts", (kind, faces, edges, vertices) => {
    const topology = getSolidTopology(createSolidEntity(kind, kind));
    expect([topology.faces.length, topology.edges.length, topology.vertices.length]).toEqual([faces, edges, vertices]);
    expect(vertices - edges + faces).toBe(2);
    for (const edge of topology.edges) expect(edge.faceIds).toHaveLength(2);
    for (const face of topology.faces) { expect(face.surface).toBe("plane"); expect(face.normal!.x * face.center.x + face.normal!.y * face.center.y + face.normal!.z * face.center.z).toBeGreaterThan(0); }
  });
  it("keeps curved surfaces, circular rims and an apex distinct from tessellation", () => {
    const cylinder = getSolidTopology(createSolidEntity("cylinder", "c"));
    expect(cylinder.faces.map((f) => f.surface)).toEqual(["plane", "curved", "plane"]);
    expect(cylinder.edges.map((e) => e.kind)).toEqual(["circle", "circle"]); expect(cylinder.vertices).toEqual([]);
    const cone = getSolidTopology(createSolidEntity("cone", "c")); expect(cone.vertices.map((v) => v.id)).toEqual(["apex"]); expect(cone.edges).toHaveLength(1);
    const sphere = getSolidTopology(createSolidEntity("sphere", "s")); expect(sphere.faces).toHaveLength(1); expect(sphere.edges).toHaveLength(0); expect(sphere.vertices).toHaveLength(0);
  });
  it("uses analytic areas and volumes including prism axis and cone/cylinder ratio", () => {
    const c = createSolidEntity("cuboid", "c"); c.dimensions = { width: 2, height: 3, depth: 4, radius: 1 };
    expect(getSolidMetrics(c)).toEqual({ volume: 24, surfaceArea: 52, baseArea: 8, height: 3 });
    const prism = { ...c, kind: "triangular-prism" as const }; expect(getSolidMetrics(prism).volume).toBe(12); expect(getSolidMetrics(prism).height).toBe(4);
    const cylinder = createSolidEntity("cylinder", "y"), cone = createSolidEntity("cone", "n");
    expect(getSolidMetrics(cylinder).volume / getSolidMetrics(cone).volume).toBeCloseTo(3);
    expect(getSolidMetrics(createSolidEntity("sphere", "s")).volume).toBeCloseTo(4 * Math.PI / 3);
  });
  it.each(SOLID_KINDS)("%s supplies a closed mesh for rendering and section extensions", (kind) => {
    const entity = createSolidEntity(kind, kind), mesh = getSolidMeshData(entity, 64);
    const edges = new Map<string, number>(); let signedVolume = 0;
    for (const face of mesh.faces) {
      face.indices.forEach((i, index) => { const j = face.indices[(index + 1) % face.indices.length], key = [i, j].sort((a, b) => a - b).join("-"); edges.set(key, (edges.get(key) ?? 0) + 1); });
      for (let i = 1; i < face.indices.length - 1; i++) { const [a, b, c] = [face.indices[0], face.indices[i], face.indices[i + 1]].map((index) => { const p = mesh.vertices[index]; return new Vector3(p.x, p.y, p.z); }); signedVolume += a.dot(b.cross(c)) / 6; }
    }
    expect([...edges.values()].every((count) => count === 2)).toBe(true);
    expect(signedVolume).toBeGreaterThan(0);
    expect(signedVolume / getSolidMetrics(entity).volume).toBeCloseTo(1, kind === "sphere" ? 2 : 2);
  });
  it("rotates with the same XYZ convention as the renderer and fits transformed solids", () => {
    const point = { x: 1, y: 2, z: 3 }, rotation = { x: 0.3, y: -0.4, z: 0.7 };
    const p = rotateSolidPoint(point, rotation), rendered = new Vector3(point.x, point.y, point.z).applyEuler(new Euler(rotation.x, rotation.y, rotation.z, "XYZ"));
    expect(p.x).toBeCloseTo(rendered.x); expect(p.y).toBeCloseTo(rendered.y); expect(p.z).toBeCloseTo(rendered.z);
    const entity = createSolidEntity("cuboid", "a", { x: 4, y: 3, z: -2 }); entity.rotation = rotation;
    const bounds = getSolidBounds(entity); for (const vertex of getSolidMeshData(entity).vertices) { const v = solidLocalToWorld(vertex, entity); for (const axis of ["x", "y", "z"] as const) { expect(v[axis]).toBeGreaterThanOrEqual(bounds.min[axis] - 1e-9); expect(v[axis]).toBeLessThanOrEqual(bounds.max[axis] + 1e-9); } }
    expect(getSolidsFrame([entity]).center).toEqual(entity.position);
  });
});
describe("teaching motion and reused drag contract", () => {
  it("interpolates size, position, opacity and orientation with exact final parameters", () => {
    const from = createSolidEntity("cuboid", "a"), to = { ...from, position: { x: 4, y: 1, z: 0 }, rotation: { x: 0, y: Math.PI / 2, z: 0 }, opacity: 0, dimensions: { ...from.dimensions, width: 4 } };
    const mid = interpolateSolidEntities([from], [to], 0.5)[0]; expect(mid.position.x).toBeGreaterThan(0); expect(mid.position.x).toBeLessThan(4); expect(mid.opacity).toBeGreaterThan(0); expect(mid.opacity).toBeLessThan(1); expect(mid.dimensions.width).toBeGreaterThan(2); expect(mid.rotation.y).toBeLessThan(Math.PI / 2);
    expect(interpolateSolidEntities([from], [to], 1)[0]).toEqual(to); expect(from.opacity).toBe(1);
  });
  it("adapts handles without changing solid geometry and rejects out-of-bounds or non-finite moves", () => {
    const entity = createSolidEntity("sphere", "a"), state = solidDragState([entity]); expect(state.cubes[0].position).toEqual(entity.position);
    const moved = moveSolidByDrag([entity], { kind: "display-move", ids: ["a"], axis: "z", distance: 1.5 })!;
    expect(moved[0].position.z).toBe(1.5); expect(moved[0].dimensions).toEqual(entity.dimensions); expect(moved[0].kind).toBe("sphere");
    expect(moveSolidByDrag([entity], { kind: "display-move", ids: ["a"], axis: "x", distance: 100 })).toBeNull();
    expect(moveSolidByDrag([entity], { kind: "display-move", ids: ["a"], axis: "x", distance: NaN })).toBeNull();
  });
});
