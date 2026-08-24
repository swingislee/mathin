"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Volume2 } from "lucide-react";
import type { SessionEventLog } from "../sync/eventlog";

const SYNC_TICK_MS = 4000;
const DRIFT_TOLERANCE_S = 1;

export interface VideoCtl {
  action: "play" | "pause" | "seek";
  time: number;
  evId: string;
}

export function VideoStage({
  pageId,
  src,
  controller,
  ctl,
  onCtl,
  log,
  fixture = false,
}: {
  pageId: string;
  src: string;
  controller: boolean;
  ctl: VideoCtl | undefined;
  onCtl: (action: VideoCtl["action"], time: number) => void;
  log: SessionEventLog | null;
  /** Rehearsal-only moving canvas stream; avoids a committed binary media fixture. */
  fixture?: boolean;
}) {
  const t = useTranslations("classroom.live");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const appliedCtl = useRef<VideoCtl | undefined>(undefined);
  const fixtureLabel = t("videoFixtureLabel");

  useEffect(() => {
    if (!fixture) return;
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 540;
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.captureStream !== "function") return;

    const draw = (elapsed: number) => {
      context.fillStyle = "#191d2b";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = "#333a4e";
      context.lineWidth = 2;
      for (let x = 0; x <= canvas.width; x += 80) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, canvas.height);
        context.stroke();
      }
      const travel = (elapsed * 150) % (canvas.width + 160) - 80;
      context.fillStyle = "#e06a6e";
      context.beginPath();
      context.arc(travel, canvas.height / 2, 54, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#f2eddf";
      context.font = "600 34px Microsoft YaHei, sans-serif";
      context.fillText(fixtureLabel, 38, 58);
      context.font = "28px ui-monospace, monospace";
      context.fillText(elapsed.toFixed(1), 38, 102);
    };
    let elapsed = 0;
    let lastFrameAt = performance.now();
    let timer: number | null = null;
    const pauseDrawing = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };
    const resumeDrawing = () => {
      if (timer !== null) return;
      lastFrameAt = performance.now();
      timer = window.setInterval(() => {
        const now = performance.now();
        elapsed += (now - lastFrameAt) / 1000;
        lastFrameAt = now;
        draw(elapsed);
      }, 1000 / 12);
    };
    draw(elapsed);
    const stream = canvas.captureStream(12);
    video.srcObject = stream;
    video.muted = true;
    video.addEventListener("play", resumeDrawing);
    video.addEventListener("pause", pauseDrawing);
    return () => {
      video.removeEventListener("play", resumeDrawing);
      video.removeEventListener("pause", pauseDrawing);
      pauseDrawing();
      video.pause();
      video.srcObject = null;
      for (const track of stream.getTracks()) track.stop();
    };
  }, [fixture, fixtureLabel]);

  const playGuarded = useCallback((video: HTMLVideoElement) => {
    void video.play().catch(() => {
      video.muted = true;
      setNeedsUnmute(true);
      void video.play().catch(() => undefined);
    });
  }, []);

  useEffect(() => {
    if (controller || !ctl || ctl === appliedCtl.current) return;
    const video = videoRef.current;
    if (!video) return;
    const apply = () => {
      if (Number.isFinite(ctl.time) && Math.abs(video.currentTime - ctl.time) > 0.5) {
        try {
          video.currentTime = ctl.time;
        } catch {
          return;
        }
      }
      appliedCtl.current = ctl;
      if (ctl.action === "play") playGuarded(video);
      else if (ctl.action === "pause") video.pause();
    };
    if (video.readyState === 0) {
      video.addEventListener("loadedmetadata", apply, { once: true });
      video.load();
      return () => video.removeEventListener("loadedmetadata", apply);
    }
    apply();
  }, [ctl, controller, playGuarded]);

  useEffect(() => {
    if (!controller || !log) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.seeking) return;
      log.sendFx({ scope: "video", payload: { pageId, time: video.currentTime } });
    }, SYNC_TICK_MS);
    return () => window.clearInterval(timer);
  }, [controller, log, pageId]);

  useEffect(() => {
    if (controller || !log) return;
    return log.onFx((fx) => {
      if (fx.scope !== "video") return;
      const payload = fx.payload as { pageId?: unknown; time?: unknown };
      if (payload.pageId !== pageId || typeof payload.time !== "number") return;
      const video = videoRef.current;
      if (!video || video.readyState === 0) return;
      if (Math.abs(video.currentTime - payload.time) > DRIFT_TOLERANCE_S) video.currentTime = payload.time;
      if (video.paused) playGuarded(video);
    });
  }, [controller, log, pageId, playGuarded]);

  if (controller) {
    return (
      <video
        ref={videoRef}
        src={fixture ? undefined : src}
        data-classroom-input="native"
        data-video-input-fixture={fixture ? "canvas-stream" : undefined}
        aria-label={fixture ? fixtureLabel : undefined}
        controls
        playsInline
        preload="auto"
        className="size-full object-contain"
        onPlay={(event) => onCtl("play", event.currentTarget.currentTime)}
        onPause={(event) => onCtl("pause", event.currentTarget.currentTime)}
        onSeeked={(event) => onCtl("seek", event.currentTarget.currentTime)}
      />
    );
  }

  return (
    <div className="relative size-full">
      <video
        ref={videoRef}
        src={fixture ? undefined : src}
        data-classroom-input="native"
        preload="auto"
        playsInline
        className="pointer-events-none size-full object-contain"
      />
      {needsUnmute && (
        <button
          type="button"
          data-classroom-input="native"
          onClick={() => {
            const video = videoRef.current;
            if (video) video.muted = false;
            setNeedsUnmute(false);
          }}
          className="absolute bottom-3 left-1/2 z-20 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink/85 px-4 py-2 text-sm text-paper shadow-lg"
        >
          <Volume2 size={15} />
          {t("enableSound")}
        </button>
      )}
    </div>
  );
}
