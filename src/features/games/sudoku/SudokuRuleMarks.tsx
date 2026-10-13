import { sudokuRules } from "./rules";
import type { SudokuVariantDefinition } from "./variant";

/** One native, scale-independent annotation layer shared by authoring and play. */
export function SudokuRuleMarks({ variant }: { variant: SudokuVariantDefinition }) {
  const rules = sudokuRules(variant), n = variant.size;
  if (rules.kind === "classic" || rules.kind === "irregular" || rules.kind === "skyscraper") return null;
  return <svg aria-hidden viewBox={`0 0 ${n * 100} ${n * 100}`} className="pointer-events-none absolute inset-0 z-[3] size-full overflow-visible">
    {rules.kind === "diagonal" && <g stroke="#b56829" strokeWidth="3" strokeDasharray="9 7" opacity="0.55">
      <path d={`M 0 0 L ${n * 100} ${n * 100}`} /><path d={`M ${n * 100} 0 L 0 ${n * 100}`} />
    </g>}
    {rules.kind === "parity" && rules.cells.map((v, i) => !v ? null : v === 1
      ? <circle key={i} cx={i % n * 100 + 50} cy={Math.floor(i / n) * 100 + 50} r="38" fill="none" stroke="#a55b38" strokeWidth="4" opacity="0.6" />
      : <rect key={i} x={i % n * 100 + 14} y={Math.floor(i / n) * 100 + 14} width="72" height="72" fill="none" stroke="#366d96" strokeWidth="4" opacity="0.6" />)}
    {rules.kind === "inequality" && rules.lessThan.map(([a, b]) => {
      const x = ((a % n + b % n) / 2 + 0.5) * 100, y = ((Math.floor(a / n) + Math.floor(b / n)) / 2 + 0.5) * 100;
      const vertical = a % n === b % n;
      return <g key={`${a}:${b}`} transform={`translate(${x},${y})`}>
        <rect x="-12" y="-16" width="24" height="32" rx="4" fill="#fffdf6" />
        <text textAnchor="middle" dominantBaseline="central" fontSize="31" fontWeight="700" fill="#733b25" transform={vertical ? "rotate(90)" : undefined}>{a < b ? "<" : ">"}</text>
      </g>;
    })}
  </svg>;
}
