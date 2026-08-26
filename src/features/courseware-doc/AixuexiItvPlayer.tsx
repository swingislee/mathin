"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { AixuexiItvEvent, AixuexiItvWidget, AixuexiPageDoc } from "./aixuexi-schema";
import type { DocVideoControl } from "./DocStage";
import styles from "./aixuexi-stage.module.css";

/**
 * 爱学习互动视频播放器。
 *
 * 源站的 ITV 是「视频 + 定点弹出的选择题」:到达节点时视频暂停、盖上该节点的定帧图,
 * 再在其上摆出题板。选项的选中/正确/错误三态由源站素材承载(stateBindingKeys),
 * 只有素材缺失时才退回本地描边反馈 —— 判定口径与镜像项目一致,不要改成永远描边。
 */

const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const;
const CHROME_IDLE_MS = 2500;
const RESUME_DELAY_CORRECT_MS = 800;
const RESUME_DELAY_WRONG_MS = 1800;
/** 与源站一致的触发提前量:避免 timeupdate 采样间隔跳过节点。 */
const TRIGGER_LEAD_SECONDS = 0.08;

function formatTime(value: number) {
  const seconds = Math.max(0, Number.isFinite(value) ? value : 0);
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function widgetStyle(widget: AixuexiItvWidget): CSSProperties {
  return {
    left: widget.x,
    top: widget.y,
    width: widget.width,
    height: widget.height,
    zIndex: widget.zIndex,
    opacity: widget.opacity,
    transform: `rotate(${widget.rotation}deg)`,
  };
}

interface ChoiceBox {
  groupId: string;
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  hasStateAssets: boolean;
  widgetIds: Set<string>;
}

/** 选项的命中框 = 该组全部部件的包围盒;源站的题板图与文字是分开的两个部件。 */
function choiceBoxes(event: AixuexiItvEvent): ChoiceBox[] {
  const byId = new Map(event.stage.widgets.map((widget) => [String(widget.id), widget]));
  return event.stage.groups
    .filter((group) => group.type === "choice")
    .map((group) => {
      const members = group.widgetIds.map((id) => byId.get(String(id))).filter((item) => item !== undefined);
      if (members.length === 0) return null;
      const left = Math.min(...members.map((item) => item.x));
      const top = Math.min(...members.map((item) => item.y));
      const right = Math.max(...members.map((item) => item.x + item.width));
      const bottom = Math.max(...members.map((item) => item.y + item.height));
      return {
        groupId: group.id,
        name: group.name,
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
        hasStateAssets: members.some((item) => Boolean(
          item.stateBindingKeys.selected ?? item.stateBindingKeys.right ?? item.stateBindingKeys.wrong,
        )),
        widgetIds: new Set(members.map((item) => String(item.id))),
      };
    })
    .filter((item) => item !== null);
}

interface AnswerState {
  groupId: string;
  correct: boolean;
  /** 被选中的那组是否真的换上了源站状态素材;没换上才画本地描边。 */
  selectedStateApplied: boolean;
}

function ItvGame({
  event,
  url,
  interactive,
  answer,
  onAnswer,
}: {
  event: AixuexiItvEvent;
  url: (key: string | null) => string | undefined;
  interactive: boolean;
  answer: AnswerState | null;
  onAnswer: (state: AnswerState) => void;
}) {
  const t = useTranslations("coursewareStage");
  const frameRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setBox({ width: rect.width, height: rect.height });
    });
    observer.observe(frame);
    setBox({ width: frame.clientWidth, height: frame.clientHeight });
    return () => observer.disconnect();
  }, []);

  const boxes = choiceBoxes(event);
  const answerGroup = event.stage.groups.find((group) => group.type === "choice" && group.isAnswer === true) ?? null;
  const answerIds = new Set(answerGroup?.widgetIds.map(String) ?? []);
  const selectedIds = answer
    ? boxes.find((item) => item.groupId === answer.groupId)?.widgetIds ?? new Set<string>()
    : new Set<string>();

  const scale = box.width > 0
    ? Math.min(box.width / event.stage.width, box.height / event.stage.height)
    : 0;
  const offsetX = Math.max(0, (box.width - event.stage.width * scale) / 2);
  const offsetY = Math.max(0, (box.height - event.stage.height * scale) / 2);

  const imageSrc = (widget: AixuexiItvWidget) => {
    const id = String(widget.id);
    if (!answer) return url(widget.resourceBindingKey);
    if (selectedIds.has(id)) {
      const state = answer.correct ? widget.stateBindingKeys.right : widget.stateBindingKeys.wrong;
      if (state) return url(state);
    } else if (!answer.correct && answerIds.has(id) && widget.stateBindingKeys.right) {
      // 答错时把真正的答案也标出来,和源站一致。
      return url(widget.stateBindingKeys.right);
    }
    return url(widget.resourceBindingKey);
  };

  return (
    <div className={styles.itvGamePanel}>
      <div ref={frameRef} className={styles.itvGameFrame}>
        <div
          className={styles.itvGameStage}
          style={{
            width: event.stage.width,
            height: event.stage.height,
            transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
            visibility: scale > 0 ? "visible" : "hidden",
          }}
        >
          {event.stage.widgets.map((widget) => {
            if (widget.type === "submit") return null;
            return (
              <div key={widget.id} className={styles.itvWidget} style={widgetStyle(widget)}>
                {widget.type === "image" && widget.resourceBindingKey ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 课件 CAS signed URL
                  <img draggable={false} alt={widget.name} src={imageSrc(widget)} />
                ) : widget.type === "text" && widget.html ? (
                  <div className="aix-html" dangerouslySetInnerHTML={{ __html: widget.html }} />
                ) : widget.type === "videoFrameTimer" ? (
                  <span className={styles.itvTimer}>{t("interactBadge")}</span>
                ) : null}
              </div>
            );
          })}
          {boxes.map((item) => {
            const selected = answer?.groupId === item.groupId;
            const markAsAnswer = Boolean(answer && !answer.correct && answerGroup?.id === item.groupId);
            return (
              <button
                key={item.groupId}
                type="button"
                aria-label={item.name || t("choiceOption")}
                data-itv-has-state={String(selected ? answer!.selectedStateApplied : item.hasStateAssets)}
                className={[
                  styles.itvChoiceHitbox,
                  selected && answer!.correct ? styles.itvCorrect : "",
                  selected && !answer!.correct ? styles.itvIncorrect : "",
                  markAsAnswer ? styles.itvAnswer : "",
                ].filter(Boolean).join(" ")}
                style={{ left: item.left, top: item.top, width: item.width, height: item.height }}
                onClick={(clickEvent) => {
                  clickEvent.preventDefault();
                  clickEvent.stopPropagation();
                  if (!interactive || answer) return;
                  const group = event.stage.groups.find((candidate) => candidate.id === item.groupId);
                  const correct = event.judgeType === "pass" || group?.isAnswer === true;
                  const state = correct ? "right" : "wrong";
                  const selectedStateApplied = event.stage.widgets.some((widget) =>
                    item.widgetIds.has(String(widget.id)) && Boolean(widget.stateBindingKeys[state]));
                  onAnswer({ groupId: item.groupId, correct, selectedStateApplied });
                }}
              >
                {markAsAnswer ? <span className={styles.itvAnswerTag}>{t("itvAnswerHere")}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
      <span className={styles.srOnly} aria-live="polite">
        {answer === null
          ? t("chooseAnswer")
          : event.judgeType === "pass"
            ? t("answerDone")
            : answer.correct
              ? t("answerCorrect")
              : t("answerWrong")}
      </span>
    </div>
  );
}

export function AixuexiItvPlayer({
  doc,
  url,
  interactive,
  videoControl,
  onClose,
}: {
  doc: AixuexiPageDoc;
  url: (key: string | null) => string | undefined;
  interactive: boolean;
  videoControl: DocVideoControl | undefined;
  onClose: () => void;
}) {
  const t = useTranslations("coursewareStage");
  const itv = doc.itvInteraction!;
  const videoRef = useRef<HTMLVideoElement>(null);
  const triggeredRef = useRef(new Set<number>());
  const lastTimeRef = useRef(0);
  const applyingRef = useRef(false);
  const chromeTimerRef = useRef<number | undefined>(undefined);
  const resumeTimerRef = useRef<number | undefined>(undefined);

  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(itv.durationSeconds);
  const [ended, setEnded] = useState(false);

  const activeEvent = activeIndex === null ? null : itv.events[activeIndex] ?? null;
  const gameActive = activeEvent !== null;

  const showChrome = useCallback(() => {
    window.clearTimeout(chromeTimerRef.current);
    setChromeHidden(false);
  }, []);

  const scheduleChrome = useCallback(() => {
    window.clearTimeout(chromeTimerRef.current);
    const video = videoRef.current;
    if (video && !video.paused && !gameActive) {
      chromeTimerRef.current = window.setTimeout(() => setChromeHidden(true), CHROME_IDLE_MS);
    }
  }, [gameActive]);

  /** 拖动进度会改变哪些节点「还没触发过」:回拖重新武装,快进跳过已越过的节点。 */
  const realignTriggers = useCallback((next: number, previous: number) => {
    if (next < previous - 0.05) {
      itv.events.forEach((event, index) => {
        if (event.positionSeconds >= next - TRIGGER_LEAD_SECONDS) triggeredRef.current.delete(index);
      });
    } else if (next > previous + 0.05) {
      itv.events.forEach((event, index) => {
        if (event.positionSeconds < next - TRIGGER_LEAD_SECONDS) triggeredRef.current.add(index);
      });
    }
  }, [itv.events]);

  const showEvent = useCallback((index: number) => {
    const video = videoRef.current;
    const event = itv.events[index];
    if (!video || !event) return;
    triggeredRef.current.add(index);
    if (event.pause) video.pause();
    setEnded(false);
    setAnswer(null);
    setActiveIndex(index);
    showChrome();
  }, [itv.events, showChrome]);

  const resume = useCallback(() => {
    const video = videoRef.current;
    setActiveIndex((index) => {
      if (video && index !== null) {
        const target = itv.events[index]?.positionSeconds ?? 0;
        video.currentTime = Math.max(video.currentTime, target + 0.05);
        lastTimeRef.current = video.currentTime;
        void video.play().catch(() => undefined);
      }
      return null;
    });
    setAnswer(null);
    showChrome();
    scheduleChrome();
  }, [itv.events, scheduleChrome, showChrome]);

  // 教室联播:控制端的 play/pause/seek 在学生端重放,重放期间不回发,避免回声。
  useEffect(() => {
    const video = videoRef.current;
    const ctl = videoControl?.ctl;
    if (!video || !ctl) return;
    applyingRef.current = true;
    try {
      if (Number.isFinite(ctl.time)) video.currentTime = ctl.time;
      if (ctl.action === "play") void video.play().catch(() => undefined);
      if (ctl.action === "pause") video.pause();
    } finally {
      window.setTimeout(() => { applyingRef.current = false; }, 120);
    }
  }, [videoControl?.ctl?.evId, videoControl?.ctl]);

  useEffect(() => () => {
    window.clearTimeout(chromeTimerRef.current);
    window.clearTimeout(resumeTimerRef.current);
  }, []);

  // 播放中每 100ms 复查一次时间线:timeupdate 的采样间隔不保证覆盖每个节点。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || gameActive || video.paused) return;
      const index = itv.events.findIndex((event, cursor) =>
        !triggeredRef.current.has(cursor) && video.currentTime + TRIGGER_LEAD_SECONDS >= event.positionSeconds);
      if (index >= 0) showEvent(index);
    }, 100);
    return () => window.clearInterval(timer);
  }, [gameActive, itv.events, showEvent]);

  const emit = (action: "play" | "pause" | "seek") => {
    if (!applyingRef.current) videoControl?.onCtl?.(action, videoRef.current?.currentTime ?? 0);
  };

  const seekTo = (next: number) => {
    const video = videoRef.current;
    if (!video) return;
    realignTriggers(next, lastTimeRef.current);
    video.currentTime = next;
    lastTimeRef.current = next;
    setCurrentTime(next);
    setEnded(false);
    showChrome();
    scheduleChrome();
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
    showChrome();
    scheduleChrome();
  };

  const pauseFrame = activeEvent?.pauseFrameBindingKey ? url(activeEvent.pauseFrameBindingKey) : undefined;
  const endFrame = ended && itv.lastFrameBindingKey ? url(itv.lastFrameBindingKey) : undefined;
  const chromeClass = chromeHidden || gameActive ? styles.itvChromeHidden : "";

  return (
    <div
      className={styles.itvOverlay}
      data-classroom-input="native"
      onClick={(event) => event.stopPropagation()}
      onPointerMove={() => {
        if (!gameActive) {
          showChrome();
          scheduleChrome();
        }
      }}
    >
      <div className={styles.itvPlayer}>
        <video
          ref={videoRef}
          playsInline
          preload="metadata"
          className={styles.fillMedia}
          src={url(itv.videoBindingKey)}
          poster={itv.posterBindingKey ? url(itv.posterBindingKey) : undefined}
          onClick={togglePlay}
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) setDuration(value);
          }}
          onDurationChange={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) setDuration(value);
          }}
          onPlay={() => {
            setPaused(false);
            setEnded(false);
            emit("play");
            scheduleChrome();
          }}
          onPause={() => {
            setPaused(true);
            emit("pause");
            showChrome();
          }}
          onSeeking={(event) => {
            const next = event.currentTarget.currentTime;
            realignTriggers(next, lastTimeRef.current);
            lastTimeRef.current = next;
            setEnded(false);
          }}
          onSeeked={() => emit("seek")}
          onTimeUpdate={(event) => {
            lastTimeRef.current = event.currentTarget.currentTime;
            setCurrentTime(event.currentTarget.currentTime);
          }}
          onEnded={() => {
            setActiveIndex(null);
            setEnded(true);
            setPaused(true);
            showChrome();
          }}
        />
        {pauseFrame ? (
          // eslint-disable-next-line @next/next/no-img-element -- 课件 CAS signed URL
          <img className={styles.itvFrameOverlay} alt={t("itvPauseFrameAlt")} src={pauseFrame} />
        ) : null}
        {endFrame ? (
          // eslint-disable-next-line @next/next/no-img-element -- 课件 CAS signed URL
          <img className={styles.itvFrameOverlay} alt={t("itvEndFrameAlt")} src={endFrame} />
        ) : null}

        {activeEvent ? (
          <ItvGame
            key={activeEvent.eventIndex}
            event={activeEvent}
            url={url}
            interactive={interactive}
            answer={answer}
            onAnswer={(state) => {
              setAnswer(state);
              window.clearTimeout(resumeTimerRef.current);
              resumeTimerRef.current = window.setTimeout(
                resume,
                state.correct ? RESUME_DELAY_CORRECT_MS : RESUME_DELAY_WRONG_MS,
              );
            }}
          />
        ) : null}

        {(["left", "right"] as const).map((side) => (
          <button
            key={side}
            type="button"
            aria-label={t("exitItv")}
            className={[
              styles.itvSideClose,
              side === "left" ? styles.itvSideCloseLeft : styles.itvSideCloseRight,
              chromeClass,
            ].filter(Boolean).join(" ")}
            onClick={(event) => {
              event.stopPropagation();
              videoRef.current?.pause();
              onClose();
            }}
          >
            ×
          </button>
        ))}

        <div className={[styles.itvControls, chromeClass].filter(Boolean).join(" ")}>
          <button
            type="button"
            className={styles.itvPlay}
            aria-label={paused ? t("itvPlay") : t("itvPause")}
            onClick={togglePlay}
          >
            {paused ? "▶" : "Ⅱ"}
          </button>
          <div className={styles.itvProgress}>
            <input
              type="range"
              className={styles.itvSeek}
              aria-label={t("itvSeek")}
              min={0}
              max={Math.max(1, duration)}
              step={0.01}
              value={Math.min(currentTime, Math.max(1, duration))}
              onChange={(event) => seekTo(Number(event.target.value))}
            />
            {itv.events.map((event, index) => (
              <button
                key={event.eventIndex}
                type="button"
                className={styles.itvMarker}
                aria-label={t("itvMarker", { index: index + 1 })}
                style={{ left: `${Math.max(0, Math.min(100, (event.positionSeconds / Math.max(1, duration)) * 100))}%` }}
                onClick={(clickEvent) => {
                  clickEvent.stopPropagation();
                  seekTo(event.positionSeconds);
                  showEvent(index);
                }}
              />
            ))}
          </div>
          <span className={styles.itvTime}>{formatTime(currentTime)} / {formatTime(duration)}</span>
          <button
            type="button"
            className={styles.itvControlButton}
            aria-label={muted ? t("itvUnmute") : t("itvMute")}
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              video.muted = !video.muted;
              setMuted(video.muted);
              showChrome();
              scheduleChrome();
            }}
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <button
            type="button"
            className={styles.itvSpeed}
            aria-label={t("itvSpeed")}
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              const next = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate as 1) + 1) % PLAYBACK_RATES.length];
              video.playbackRate = next;
              setRate(next);
              showChrome();
              scheduleChrome();
            }}
          >
            {rate}×
          </button>
        </div>
      </div>
    </div>
  );
}
