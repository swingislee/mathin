"use client";

import { useId, useRef, useState, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import { Hand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { calibratePalmEraser, contactSize, type ContactSize } from "../input/palm-eraser";
import type { usePalmEraserSettings } from "../input/usePalmEraserSettings";

type Step = "intro" | "finger" | "palm" | "done";
type CalibrationError = "unavailable" | "indistinct" | "singleFinger" | "useTouch" | "interrupted";

/** 校准只采集触点面积；样本留在当前对话框，保存本设备识别阈值。 */
export function ClassroomPalmEraserSettings({ onClose, device }: {
  onClose: () => void;
  device: ReturnType<typeof usePalmEraserSettings>;
}) {
  const t = useTranslations("classroom.live.palmEraser");
  const switchId = useId();
  const [step, setStep] = useState<Step>("intro");
  const [error, setError] = useState<CalibrationError | null>(null);
  const [touching, setTouching] = useState(false);
  const finger = useRef<ContactSize[]>([]);
  const capture = useRef({ ids: new Set<number>(), samples: [] as ContactSize[], multiple: false, cancelled: false });
  const calibrating = step === "finger" || step === "palm";
  const start = () => {
    finger.current = [];
    capture.current = { ids: new Set(), samples: [], multiple: false, cancelled: false };
    setError(null); setTouching(false); setStep("finger");
  };
  const pointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!calibrating) return;
    if (event.pointerType !== "touch") { if (event.type === "pointerdown") setError("useTouch"); return; }
    event.preventDefault(); event.stopPropagation();
    const current = capture.current;
    if (event.type === "pointerdown") {
      if (!current.ids.size) { current.samples = []; current.multiple = false; current.cancelled = false; setError(null); }
      current.ids.add(event.pointerId);
      current.multiple ||= current.ids.size > 1;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
      setTouching(true);
    } else if (!current.ids.has(event.pointerId)) return;
    if (event.type === "pointerdown" || event.type === "pointermove") {
      if (current.samples.length < 128) current.samples.push({ width: event.width, height: event.height });
    }
    if (event.type !== "pointerup" && event.type !== "pointercancel") return;
    current.cancelled ||= event.type === "pointercancel";
    current.ids.delete(event.pointerId);
    if (current.ids.size) return;
    setTouching(false);
    if (current.cancelled) { setError("interrupted"); return; }
    if (step === "finger" && current.multiple) { setError("singleFinger"); return; }
    if (!current.samples.some((sample) => contactSize(sample) > 0)) { setError("unavailable"); return; }
    if (step === "finger") { finger.current = [...current.samples]; setStep("palm"); return; }
    const result = calibratePalmEraser(finger.current, current.samples, device.screenKey);
    if (result.error) { setError(result.error); return; }
    device.save({ enabled: true, profile: result.profile });
    setError(null); setStep("done");
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-11 items-center justify-between gap-4">
          <label htmlFor={switchId} className="text-sm">{t("enabled")}</label>
          <Switch id={switchId} checked={device.active} disabled={!device.calibrated || calibrating}
            onCheckedChange={(enabled) => device.save({ ...device.settings, enabled })} />
        </div>
        {calibrating ? (
          <>
            <p className="text-sm font-medium" aria-live="polite">{t(step === "finger" ? "fingerStep" : "palmStep")}</p>
            <div className="flex h-56 touch-none select-none flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line bg-moon/20 px-6 text-center"
              data-classroom-palm-calibration={step} onPointerDown={pointer} onPointerMove={pointer} onPointerUp={pointer} onPointerCancel={pointer}>
              <Hand aria-hidden size={36} className={touching ? "text-crater" : "text-muted"} />
              <p className="text-sm leading-relaxed">{t(touching ? "release" : step === "finger" ? "fingerHint" : "palmHint")}</p>
            </div>
          </>
        ) : <p role="status" className="text-sm leading-relaxed text-muted">{t(step === "done" ? "ready" : device.calibrated ? "calibrated" : "setupHint")}</p>}
        {error && <p role="status" className="text-sm leading-relaxed text-crater">{t(error)}</p>}
        {device.sessionOnly && <p className="text-xs text-muted">{t("sessionOnly")}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" className="min-h-11" onClick={onClose}>{t("close")}</Button>
          {step !== "done" && <Button type="button" className="min-h-11" disabled={touching} onClick={start}>{t(calibrating || device.calibrated ? "recalibrate" : "calibrate")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
