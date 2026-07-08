"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Volume2 } from "lucide-react";
import type { SessionEventLog } from "../sync/eventlog";

const SYNC_TICK_MS = 4000;
const DRIFT_TOLERANCE_S = 1;

export interface VideoCtl {
  action: "play" | "pause" | "seek";
  time: number;
  /** 事件 id：每个新事件都是新对象，跟随端按引用判「未应用过」。 */
  evId: string;
}

/**
 * 视频课件页的同步播放（用户 2026-07-08 要求）：教师端是唯一控制者，
 * play/pause/seek 走持久事件 video_ctl（晚加入可重放到位）；
 * 播放中每 4s 一发 fx 对时（可丢），跟随端漂移 >1s 才校正。
 * 跟随端自动播放被浏览器拦截时降级为静音播放 + 「开启声音」按钮。
 */
export function VideoStage({
  pageId,
  src,
  controller,
  ctl,
  onCtl,
  log,
}: {
  pageId: string;
  src: string;
  controller: boolean;
  ctl: VideoCtl | undefined;
  onCtl: (action: VideoCtl["action"], time: number) => void;
  log: SessionEventLog | null;
}) {
  const t = useTranslations("classroom.live");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const appliedCtl = useRef<VideoCtl | undefined>(undefined);

  const playGuarded = (video: HTMLVideoElement) => {
    video.play().catch(() => {
      // 自动播放策略拦截：静音重试，让画面先动起来，声音一键恢复
      video.muted = true;
      setNeedsUnmute(true);
      video.play().catch(() => undefined);
    });
  };

  // 跟随端：应用控制事件
  useEffect(() => {
    if (controller || !ctl || ctl === appliedCtl.current) return;
    appliedCtl.current = ctl;
    const video = videoRef.current;
    if (!video) return;
    if (Number.isFinite(ctl.time) && Math.abs(video.currentTime - ctl.time) > 0.5) {
      video.currentTime = ctl.time;
    }
    if (ctl.action === "play") playGuarded(video);
    else if (ctl.action === "pause") video.pause();
    // seek 保持当前播放态
  }, [ctl, controller]);

  // 教师端：播放中定时对时（fx 可丢，不落库）
  useEffect(() => {
    if (!controller || !log) return;
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.seeking) return;
      log.sendFx({ scope: "video", payload: { pageId, time: video.currentTime } });
    }, SYNC_TICK_MS);
    return () => clearInterval(timer);
  }, [controller, log, pageId]);

  // 跟随端：收对时 fx 校正漂移
  useEffect(() => {
    if (controller || !log) return;
    return log.onFx((fx) => {
      if (fx.scope !== "video") return;
      const payload = fx.payload as { pageId?: unknown; time?: unknown };
      if (payload.pageId !== pageId || typeof payload.time !== "number") return;
      const video = videoRef.current;
      if (!video) return;
      if (Math.abs(video.currentTime - payload.time) > DRIFT_TOLERANCE_S) {
        video.currentTime = payload.time;
      }
      if (video.paused) playGuarded(video);
    });
  }, [controller, log, pageId]);

  if (controller) {
    return (
      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        className="size-full object-contain"
        onPlay={(event) => onCtl("play", event.currentTarget.currentTime)}
        onPause={(event) => onCtl("pause", event.currentTarget.currentTime)}
        onSeeked={(event) => onCtl("seek", event.currentTarget.currentTime)}
      />
    );
  }

  return (
    <div className="relative size-full">
      <video ref={videoRef} src={src} playsInline className="size-full object-contain" />
      {needsUnmute && (
        <button
          type="button"
          onClick={() => {
            const video = videoRef.current;
            if (video) video.muted = false;
            setNeedsUnmute(false);
          }}
          className="absolute bottom-3 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink/85 px-4 py-2 text-sm text-paper shadow-lg"
        >
          <Volume2 size={15} />
          {t("enableSound")}
        </button>
      )}
    </div>
  );
}
