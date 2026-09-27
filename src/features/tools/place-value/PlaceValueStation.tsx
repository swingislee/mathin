"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SpatialActionIcon } from "../spatial-interaction/SpatialActionIcon";
import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";
import { boardTotal, digitSymbol, parsePlaceValue, placeValueLimit, type PlaceValuePlace, type PlaceValueSide, type PlaceValueSnapshot } from "./radix-contract";
import { isPlaceValueRegrouping, placeValueCarry, placeValueNotation, placeValuePendingCarry } from "./radix-model";
import { placeValueCarryLabel, placeValueLabel, placeValueMessages } from "./messages";
import styles from "./PlaceValueWorkspace.module.css";

export interface PlaceValueStationProps {
  snapshot: PlaceValueSnapshot; side: PlaceValueSide; place: PlaceValuePlace; progress: number; locale: "zh" | "en";
  disabled: boolean; publishing: boolean;
  onCountChange: (side: PlaceValueSide, place: PlaceValuePlace, count: number) => void;
  onCarry: (side: PlaceValueSide, place: PlaceValuePlace) => void;
  onToggleMotion: () => void;
  onHighlight: (place: PlaceValuePlace) => void;
}

/** 数位数字跟随本列；进位单独锚定在相邻两列之间。 */
export function PlaceValueStation({ snapshot, side, place, progress, locale, disabled, publishing, onCountChange, onHighlight }: PlaceValueStationProps) {
  const m = placeValueMessages(locale), board = snapshot[side], count = board.places[place].length, weight = board.radix ** place;
  const name = placeValueLabel(locale, place, board.radix);
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState("");
  const cancelled = useRef(false);
  const { before, after, blend } = placeValueNotation(snapshot, side, place, progress);
  const countDisabled = disabled || placeValuePendingCarry(snapshot, side) !== null;
  const numeral = ({ digit, extra }: typeof before) => <><span className={styles.digit}>{digitSymbol(digit)}</span><span className={styles.addend}>{extra ? "+" + extra : ""}</span></>;
  const finishEdit = () => {
    const value = parsePlaceValue(draft, board.radix);
    if (!cancelled.current && draft.trim().length === 1 && value !== null && !countDisabled) onCountChange(side, place, value);
    setEditing(false);
  };
  return <div className={styles.station} data-place-value-station={side + ":" + place} data-place-value-digits onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
    {snapshot.showLabels && (snapshot.mode === "compare" ? <Button variant="ghost" className={styles.placeTitle} disabled={publishing} aria-pressed={snapshot.highlight === place} onClick={() => onHighlight(place)}>{name}</Button> : <div className={styles.placeTitle}>{name}</div>)}
    {snapshot.showDigits && <div className={styles.numeral} aria-live="polite">
      {editing ? <Input autoFocus aria-label={m.editPlace(name)} type="text" inputMode={board.radix === 16 ? "text" : "numeric"} maxLength={1} value={draft} disabled={countDisabled} className={styles.digitInput}
        onFocus={(event) => event.target.select()} onChange={(event) => setDraft(event.target.value)} onBlur={finishEdit}
        onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { cancelled.current = true; setEditing(false); } }} />
        : <Button variant="ghost" className={styles.numberButton} disabled={countDisabled} aria-label={m.editPlace(name)}
          onClick={() => { cancelled.current = false; setDraft(digitSymbol(Math.min(board.radix - 1, count))); setEditing(true); }}>
          {blend < 1 && <span className={styles.numeralLayer} data-place-value-numeral="before" style={{ opacity: 1 - blend, transform: "translateY(" + -12 * blend + "px)" }}>{numeral(before)}</span>}
          <span className={styles.numeralLayer} data-place-value-numeral="after" style={{ opacity: blend, transform: "translateY(" + 12 * (1 - blend) + "px)" }}>{numeral(after)}</span>
        </Button>}
    </div>}
    <div className={styles.counterButtons}>
      <SpatialActionButton action="decrease" className={styles.counterButton} disabled={countDisabled || !count} label={place === 0 ? m.remove : m.removeAt(name)} onClick={() => onCountChange(side, place, count - 1)} />
      <SpatialActionButton action="add" className={styles.counterButton} disabled={countDisabled || boardTotal(board) + weight > placeValueLimit(board.radix, board.places.length)} label={place === 0 ? m.add : m.addAt(name)} onClick={() => onCountChange(side, place, count + 1)} />
    </div>
  </div>;
}
export function PlaceValueCarryControl({ snapshot, side, place, progress, locale, disabled, publishing, onCarry, onToggleMotion }: PlaceValueStationProps) {
  const m = placeValueMessages(locale), motion = snapshot.motion;
  const carrying = motion?.side === side && isPlaceValueRegrouping(motion.kind) && (motion.kind === "carry" ? motion.level : motion.level - 1) === place && progress < 1;
  const ready = placeValueCarry(snapshot[side]) === place;
  const label = carrying ? motion.paused ? m.resume : m.pause : placeValueCarryLabel(locale, place, snapshot[side].radix);
  return <Button variant="secondary" className={styles.carryButton} data-carry-between={side + ":" + place + ":" + (place + 1)} data-carry-visible={ready || carrying}
    aria-hidden={!ready && !carrying} tabIndex={ready || carrying ? 0 : -1} disabled={carrying ? publishing : disabled || !ready} aria-label={label} title={label}
    onPointerDown={(event) => event.stopPropagation()} onClick={() => carrying ? onToggleMotion() : onCarry(side, place)}>
    <SpatialActionIcon action={carrying ? motion.paused ? "play" : "pause" : "placeCarry"} />{carrying ? motion.paused ? m.resumeLabel : m.pauseLabel : m.carryLabel}
  </Button>;
}
