"use client";

import { Crown, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { startGame, submitScore } from "./actions";
import { formatMs } from "./format";
import { getGame } from "./registry";
import type { Difficulty } from "./types";

type Phase = "idle" | "starting" | "playing" | "submitting" | "done";

function localSeed() {
  return Math.random().toString(36).slice(2);
}

function nowMs() {
  return Date.now();
}

/** 对局页统一框架（docs/plan/02-3.2）：卷轴计时条 + 难度/重开 + 面板 + 结果条。 */
export function GameMatch({ gameId, loggedIn }: { gameId: string; loggedIn: boolean }) {
  const game = getGame(gameId);
  const t = useTranslations("games");
  const [phase, setPhase] = useState<Phase>("idle");
  const [difficulty, setDifficulty] = useState<Difficulty>(game?.difficulties[0] ?? "easy");
  const [seed, setSeed] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recorded, setRecorded] = useState<"yes" | "no" | "failed">("no");
  const startedAtRef = useRef(0);

  const playing = phase === "playing";
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 500);
    return () => clearInterval(timer);
  }, [playing]);

  if (!game) return null;

  async function begin(nextDifficulty: Difficulty) {
    setDifficulty(nextDifficulty);
    setPhase("starting");
    setElapsedMs(0);
    if (loggedIn) {
      const res = await startGame(gameId, nextDifficulty);
      if (res.ok) {
        setSeed(res.seed);
        setSessionId(res.sessionId);
      } else {
        // 会话过期等场景退化为本地对局
        setSeed(localSeed());
        setSessionId(null);
      }
    } else {
      setSeed(localSeed());
      setSessionId(null);
    }
    startedAtRef.current = nowMs();
    setPhase("playing");
  }

  async function handleComplete(proof: unknown) {
    const durationMs = nowMs() - startedAtRef.current;
    setElapsedMs(durationMs);
    if (!sessionId) {
      setRecorded("no");
      setPhase("done");
      return;
    }
    setPhase("submitting");
    const res = await submitScore(sessionId, durationMs, proof);
    setRecorded(res.ok ? "yes" : "failed");
    setPhase("done");
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* 卷轴横条：计时器居中，庄重衬线数字（docs/plan/05-3.2） */}
      <div className="flex items-center justify-between gap-3 rounded-xl border-y-2 border-x border-(--p-line) bg-(--p-wash) px-4 py-2.5">
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label={t("difficultyLabel")}>
          {game.difficulties.map((d, i) => (
            <button
              key={d}
              role="radio"
              aria-checked={difficulty === d}
              disabled={phase === "starting" || phase === "submitting"}
              onClick={() => begin(d)}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors duration-200",
                difficulty === d ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              {Array.from({ length: i + 1 }, (_, k) => (
                <Crown key={k} size={11} className="text-(--p-accent-2)" fill="currentColor" />
              ))}
              {t(`difficulty.${d}`)}
            </button>
          ))}
        </div>
        <span className="font-serif text-lg tabular-nums" aria-live="off">{formatMs(elapsedMs)}</span>
        <Button variant="ghost" size="sm" className="px-2" onClick={() => begin(difficulty)} disabled={phase === "starting"}>
          <RotateCcw size={14} />
          {phase === "idle" ? t("start") : t("restart")}
        </Button>
      </div>

      {/* 面板外框：敕令双线框 */}
      <div className="mt-6 rounded-2xl border-4 border-double border-(--p-line) p-4 sm:p-6">
        {phase === "idle" ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
            <p className="text-sm text-muted">{t("pickDifficulty")}</p>
            <Button variant="secondary" onClick={() => begin(difficulty)}>{t("start")}</Button>
          </div>
        ) : (
          <game.Board
            key={`${seed}:${difficulty}`}
            seed={seed}
            difficulty={difficulty}
            finished={phase === "done" || phase === "submitting"}
            onComplete={handleComplete}
          />
        )}
      </div>

      <div aria-live="polite">
        {phase === "submitting" && <p className="mt-4 text-center text-sm text-muted">{t("submitting")}</p>}
        {phase === "done" && (
          <p className="mt-4 text-center text-sm">
            <span className="font-medium">{t("finishedIn", { time: formatMs(elapsedMs) })}</span>
            <span className="ml-2 text-muted">
              {recorded === "yes" ? t("recorded") : recorded === "failed" ? t("submitFailed") : t("notRecorded")}
            </span>
          </p>
        )}
        {!loggedIn && <p className="mt-4 text-center text-xs text-muted">{t("loginToRank")}</p>}
      </div>
    </div>
  );
}
