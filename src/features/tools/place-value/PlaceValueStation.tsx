"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SpatialActionIcon } from "../spatial-interaction/SpatialActionIcon";
import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";
import { boardTotal, type PlaceValuePlace, type PlaceValueSide, type PlaceValueSnapshot } from "./contract";
import { isPlaceValueRegrouping, PLACE_VALUE_WEIGHTS, placeValueNotation } from "./model";
import { placeValueMessages } from "./messages";
import styles from "./PlaceValueWorkspace.module.css";

export interface PlaceValueStationProps {
  snapshot: PlaceValueSnapshot; side: PlaceValueSide; place: PlaceValuePlace; progress: number; locale: "zh" | "en";
  disabled: boolean; publishing: boolean;
  onCountChange: (side: PlaceValueSide, place: PlaceValuePlace, count: number) => void;
  onCarry: (side: PlaceValueSide, place: PlaceValuePlace) => void;
  onToggleMotion: () => void;
  onHighlight: (place: PlaceValuePlace) => void;
}

/** 同一数位的积木、数字、加减与进位共用一个世界坐标锚点。 */
export function PlaceValueStation({ snapshot, side, place, progress, locale, disabled, publishing, onCountChange, onCarry, onToggleMotion, onHighlight }: PlaceValueStationProps) {
  const m = placeValueMessages(locale), board = snapshot[side], count = board[place].length, weight = PLACE_VALUE_WEIGHTS[place];
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState("");
  const cancelled = useRef(false);
  const { before, after, blend } = placeValueNotation(snapshot, side, place, progress);
  const motion = snapshot.motion;
  const motionPlace = motion?.kind === "carry-one" || motion?.kind === "unpack-ten" ? "ones" : "tens";
  const carrying = motion?.side === side && isPlaceValueRegrouping(motion.kind) && motionPlace === place && progress < 1;
  const ready = place !== "hundreds" && count >= 10;
  const numeral = ({ digit, extra }: typeof before) => <><span className={styles.digit}>{digit}</span><span className={styles.addend}>{extra ? "+" + extra : ""}</span></>;
  const finishEdit = () => {
    if (!cancelled.current && draft.trim() && /^\d$/.test(draft.trim()) && !disabled) onCountChange(side, place, Number(draft));
    setEditing(false);
  };
  return <div className={styles.station} data-place-value-station={side + ":" + place} data-place-value-digits onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
    {snapshot.showLabels && (snapshot.mode === "compare" ? <Button variant="ghost" className={styles.placeTitle} disabled={publishing} aria-pressed={snapshot.highlight === place} onClick={() => onHighlight(place)}>{m[place]}</Button> : <div className={styles.placeTitle}>{m[place]}</div>)}
    {snapshot.showDigits && <div className={styles.numeral} aria-live="polite">
      {editing ? <Input autoFocus aria-label={m.editPlace(m[place])} type="text" inputMode="numeric" maxLength={1} value={draft} disabled={disabled} className={styles.digitInput}
        onFocus={(event) => event.target.select()} onChange={(event) => setDraft(event.target.value)} onBlur={finishEdit}
        onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { cancelled.current = true; setEditing(false); } }} />
        : <Button variant="ghost" className={styles.numberButton} disabled={disabled} aria-label={m.editPlace(m[place])}
          onClick={() => { cancelled.current = false; setDraft(String(Math.min(9, count))); setEditing(true); }}>
          {blend < 1 && <span className={styles.numeralLayer} data-place-value-numeral="before" style={{ opacity: 1 - blend, transform: "translateY(" + -12 * blend + "px)" }}>{numeral(before)}</span>}
          <span className={styles.numeralLayer} data-place-value-numeral="after" style={{ opacity: blend, transform: "translateY(" + 12 * (1 - blend) + "px)" }}>{numeral(after)}</span>
        </Button>}
    </div>}
    <div className={styles.counterButtons}>
      <SpatialActionButton action="decrease" className={styles.counterButton} disabled={disabled || !count} label={place === "ones" ? m.remove : m.removeAt(m[place])} onClick={() => onCountChange(side, place, count - 1)} />
      <SpatialActionButton action="add" className={styles.counterButton} disabled={disabled || boardTotal(board) + weight > 999} label={place === "ones" ? m.add : m.addAt(m[place])} onClick={() => onCountChange(side, place, count + 1)} />
    </div>
    <Button variant="secondary" className={styles.carryButton} data-carry-visible={ready || carrying} aria-hidden={!ready && !carrying} tabIndex={ready || carrying ? 0 : -1}
      disabled={carrying ? publishing : disabled || !ready} aria-label={carrying ? motion.paused ? m.resume : m.pause : place === "ones" ? m.carryOne : m.carryTen}
      onClick={() => carrying ? onToggleMotion() : onCarry(side, place)}>
      <SpatialActionIcon action={carrying ? motion.paused ? "play" : "pause" : "placeCarry"} />{carrying ? motion.paused ? m.resumeLabel : m.pauseLabel : m.carryLabel}
    </Button>
  </div>;
}
