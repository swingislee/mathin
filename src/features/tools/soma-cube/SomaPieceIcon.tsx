import { somaDefinition, type SomaId } from "./pieces";

/** 七宝缩略图由同一单位格定义投影，目录与画布保持形状一致。 */
export function SomaPieceIcon({ id }: { id: SomaId }) {
  const piece = somaDefinition(id), size = 9;
  const project = (x: number, y: number, z: number) => [34 + (x - z) * size, 35 + (x + z) * size / 2 - y * size];
  const cells = [...piece.cells].sort((a, b) => a.x + a.z - b.x - b.z || a.y - b.y);
  const polygon = (points: number[][]) => points.map((p) => p.join(",")).join(" ");
  return <svg viewBox="0 0 56 56" aria-hidden className="size-10 shrink-0">
    {cells.map(({ x, y, z }, index) => <g key={index} fill={piece.color} stroke="var(--ink)" strokeWidth="0.65" strokeLinejoin="round">
      <polygon points={polygon([project(x, y + 1, z), project(x + 1, y + 1, z), project(x + 1, y + 1, z + 1), project(x, y + 1, z + 1)])} />
      <polygon points={polygon([project(x, y, z + 1), project(x + 1, y, z + 1), project(x + 1, y + 1, z + 1), project(x, y + 1, z + 1)])} />
      <polygon points={polygon([project(x + 1, y, z), project(x + 1, y, z + 1), project(x + 1, y + 1, z + 1), project(x + 1, y + 1, z)])} />
    </g>)}
  </svg>;
}
