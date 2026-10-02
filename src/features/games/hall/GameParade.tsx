"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Crown, RotateCcw } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { GAME_SUIT_GLYPH, type GameParadeCard, type GameParadeLabels } from "./parade-contract";

/** 牌阵两侧最多露出的张数；更远的牌收到队尾后面。 */
const VISIBLE_SIDE = 3;
/** 横向拖动超过该距离才算换牌，避免点击时的轻微抖动。 */
const SWIPE_THRESHOLD = 48;
/** 指针离中线超过牌阵半宽的该比例后开始向两侧让牌。 */
const EDGE_START = 0.45;
/** 指针在牌角时的最大倾斜角（度）。 */
const MAX_TILT_X = 12;
const MAX_TILT_Y = 16;

function resetTilt(card: HTMLElement) {
  for (const name of ["--tilt-x", "--tilt-y", "--glare-x", "--glare-y"]) card.style.removeProperty(name);
}

/**
 * 扑克侍卫牌阵：每个游戏是一张站在红毯上的扑克牌，沿弧线首尾相接排开。
 * 正中一张正对玩家并可翻面看战绩；两侧的牌侧转、压暗，点一下即走到中间。
 * 每张牌的位置只写入 `--d`（相对正中的偏移），排布、侧转与翻面由 globals.css 的 `.game-parade` 维护。
 * 鼠标悬浮另写 `--lean`（靠边让牌）与 `--tilt-*` / `--glare-*`（当前牌倾斜与反光），触屏不启用。
 */
export function GameParade({ cards, labels, signedIn }: {
  cards: GameParadeCard[];
  labels: GameParadeLabels;
  signedIn: boolean;
}) {
  const [active, setActive] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const swipe = useRef<{ x: number; moved: boolean } | null>(null);
  const tilted = useRef<HTMLElement | null>(null);
  const count = cards.length;

  const go = (index: number) => {
    setActive(((index % count) + count) % count);
    setFlipped(false);
  };
  // 首尾相接：取离正中最近的方向。
  const offsetOf = (index: number) => {
    let d = index - active;
    if (d > count / 2) d -= count;
    if (d < -count / 2) d += count;
    return d;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") go(active - 1);
    else if (event.key === "ArrowRight") go(active + 1);
    else return;
    event.preventDefault();
  };
  // 鼠标悬浮：当前牌跟随指针倾斜并移动反光；指针靠近牌阵两侧时整列牌向该侧让出下一张。
  // 直接写 CSS 变量，不触发重渲染。
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const track = event.currentTarget;
    const bounds = track.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const lean = Math.sign(x) * Math.min(1, Math.max(0, (Math.abs(x) - EDGE_START) / (1 - EDGE_START)));
    track.style.setProperty("--lean", lean.toFixed(3));

    const card = event.target instanceof Element ? event.target.closest<HTMLElement>(".game-card[data-active]") : null;
    if (tilted.current && tilted.current !== card) resetTilt(tilted.current);
    tilted.current = card;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    card.style.setProperty("--tilt-x", `${((0.5 - py) * 2 * MAX_TILT_X).toFixed(2)}deg`);
    card.style.setProperty("--tilt-y", `${((px - 0.5) * 2 * MAX_TILT_Y).toFixed(2)}deg`);
    card.style.setProperty("--glare-x", `${(px * 100).toFixed(1)}%`);
    card.style.setProperty("--glare-y", `${(py * 100).toFixed(1)}%`);
  };
  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.setProperty("--lean", "0");
    if (tilted.current) resetTilt(tilted.current);
    tilted.current = null;
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button === 0) swipe.current = { x: event.clientX, moved: false };
  };
  const onPointerUp = (event: PointerEvent) => {
    const start = swipe.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      start.moved = true;
      go(active - Math.sign(dx));
    } else {
      swipe.current = null;
    }
  };
  // 拖动换牌后紧跟的 click 不再触发牌面链接或选牌。
  const onClickCapture = (event: MouseEvent) => {
    if (!swipe.current?.moved) return;
    swipe.current = null;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <section className="game-parade" aria-label={labels.region} aria-roledescription="carousel" onKeyDown={onKeyDown}>
      <div
        className="game-parade-track"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
        onClickCapture={onClickCapture}
      >
        {cards.map((card, index) => {
          const d = offsetOf(index);
          const abs = Math.abs(d);
          const isActive = d === 0;
          const glyph = GAME_SUIT_GLYPH[card.suit];
          return (
            <div
              key={card.id}
              role="group"
              aria-roledescription={labels.slide}
              aria-label={`${card.name} · ${card.position}`}
              aria-hidden={abs > VISIBLE_SIDE || undefined}
              className="game-card"
              data-suit={card.suit}
              data-active={isActive || undefined}
              data-far={abs > VISIBLE_SIDE || undefined}
              data-flipped={(isActive && flipped) || undefined}
              style={{ "--d": d, "--abs": abs, zIndex: 20 - abs } as CSSProperties}
            >
              <div className="game-card-tilt">
                <div className="game-card-inner" inert={!isActive}>
                  <div className="game-card-face game-card-front" inert={isActive && flipped}>
                    <span className="game-card-glare" aria-hidden />
                    <span className="game-card-corner" aria-hidden>
                      {String(card.no).padStart(2, "0")}
                      <span>{glyph}</span>
                    </span>
                    <span className="game-card-corner game-card-corner-end" aria-hidden>
                      {String(card.no).padStart(2, "0")}
                      <span>{glyph}</span>
                    </span>
                    <span className="game-card-medallion">{card.icon}</span>
                    <span className="game-card-suit">{glyph} {card.suitLabel}</span>
                    <h2 className="game-card-name font-display">{card.name}</h2>
                    <p className="game-card-desc">{card.desc}</p>
                    <span className="game-card-crowns" role="img" aria-label={`${labels.difficultyLabel} ${card.crowns}/3`}>
                      {Array.from({ length: 3 }, (_, i) => (
                        <Crown key={i} fill={i < card.crowns ? "currentColor" : "none"} data-lit={i < card.crowns || undefined} />
                      ))}
                    </span>
                    <div className="game-card-actions">
                      <Link href={`/games/${card.id}`} className={cn(buttonVariants({ size: "sm" }), "game-card-start")}>{labels.start}</Link>
                      <button type="button" className="game-card-flip" onClick={() => setFlipped(true)}>
                        <RotateCcw aria-hidden />
                        {labels.flip}
                      </button>
                    </div>
                  </div>

                  <div className="game-card-face game-card-back" inert={!(isActive && flipped)}>
                    <div className="game-card-back-panel">
                      <span className="game-card-back-eyebrow">{labels.records}</span>
                      <strong className="game-card-back-name font-display">{card.name}</strong>
                      <dl className="game-card-records">
                        {card.records.map((record) => (
                          <div key={record.difficulty} data-cleared={record.best !== null || undefined}>
                            <dt>{record.label}</dt>
                            <dd>{record.best ?? labels.noRecord}</dd>
                          </div>
                        ))}
                      </dl>
                      {signedIn ? null : <p className="game-card-login">{labels.loginToRank}</p>}
                      <div className="game-card-actions">
                        <Link href={`/games/${card.id}/ranks`} className={cn(buttonVariants({ size: "sm" }), "game-card-start")}>{labels.ranks}</Link>
                        <button type="button" className="game-card-flip" onClick={() => setFlipped(false)}>
                          <RotateCcw aria-hidden />
                          {labels.flipBack}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {isActive ? null : (
                <button type="button" className="game-card-pick" aria-label={card.name} tabIndex={-1} onClick={() => go(index)} />
              )}
            </div>
          );
        })}
      </div>

      <div className="game-parade-controls">
        <button type="button" className="game-parade-arrow" aria-label={labels.prev} onClick={() => go(active - 1)}>
          <ChevronLeft aria-hidden />
        </button>
        <div className="game-parade-pips">
          {cards.map((card, index) => (
            <button
              key={card.id}
              type="button"
              className="game-parade-pip"
              data-suit={card.suit}
              aria-label={card.name}
              aria-current={index === active || undefined}
              onClick={() => go(index)}
            >
              {GAME_SUIT_GLYPH[card.suit]}
            </button>
          ))}
        </div>
        <button type="button" className="game-parade-arrow" aria-label={labels.next} onClick={() => go(active + 1)}>
          <ChevronRight aria-hidden />
        </button>
      </div>
      <p className="sr-only" aria-live="polite">{cards[active] ? `${cards[active].name} · ${cards[active].position}` : null}</p>
    </section>
  );
}
