import { dicePipShades, diceSurface } from "./dice-teaching-display";
import { PIP_POINTS, faceValue, type DiceFace, type TeachingDie } from "./dice-teaching-model";
import { diceTeachingMessages } from "./dice-teaching-messages";

/** 明确标为正视副本，不旋转真实面；隐藏点数也不进入 SVG 或无障碍标签。 */
export function DiceFaceInspection({ die, face, label, locale }: { die: TeachingDie; face: DiceFace; label: string; locale: string }) {
  const m = diceTeachingMessages(locale), hidden = die.hidden.includes(face);
  const value = hidden ? 0 : faceValue(die.hand, face), surface = diceSurface(die, face);
  return <figure className="space-y-2" data-dice-face-inspection>
    <figcaption className="text-center">{m.die} {die.id.replace("dice-", "")} · {label}</figcaption>
    <svg viewBox="0 0 100 100" role="img" aria-label={`${label} · ${hidden ? m.hidden : value}`} className="mx-auto w-28 max-w-full">
      <rect x="2" y="2" width="96" height="96" rx="12" fill={surface.color} stroke="var(--line)" strokeWidth="1.5" />
      {PIP_POINTS[value].map(([x, y], index) => <circle key={index} cx={50 + x * 100} cy={50 - y * 100} r="6" fill={dicePipShades(value)[1]} />)}
      {hidden && <text x="50" y="61" textAnchor="middle" fill="var(--muted)" fontSize="32">?</text>}
    </svg>
    <p className="text-center text-muted leading-5">{m.inspectionHint}</p>
  </figure>;
}
