"use client";

import { ImageUp, Play } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ImageCropDialog } from "@/components/image-crop-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLongPress } from "@/hooks/use-long-press";
import { cn } from "@/lib/utils";
import { EditableNumber, NumField } from "./NumField";
import { DEFAULT_HEAD, EMPTY_VEHICLE, PANEL_W, POST_PAD, VEHICLES, VEHICLE_SPEEDS, fmt, type Runway, type SolveKey } from "./shared";

function readImageFile(file: File | undefined, cb: (dataUrl: string) => void) {
  if (!file) return;
  const reader = new FileReader();
  reader.onloadend = () => typeof reader.result === "string" && cb(reader.result);
  reader.readAsDataURL(file);
}

const VEHICLE_NAMES = ["walk", "bicycle", "car", "plane", "rocket", "cloud", "wormhole"] as const;
const CHARACTER_DRAG_THRESHOLD_PX = 3;
// 旧版 CircleUpload 的八个方位；中心留给方向与位置输入。
const MENU_POSITIONS = [[0, -75], [53, -53], [75, 0], [53, 53], [0, 75], [-53, 53], [-75, 0], [-53, -53]];
const menuPosition = (index: number) => ({ transform: `translate(-50%, -50%) translate(${MENU_POSITIONS[index][0]}px, ${MENU_POSITIONS[index][1]}px)` });

export function RunwayLane({ runway, length, ppm, locked, onMove, onField, onSolve, onPatch, onVehicle, onMeasure }: {
  runway: Runway;
  length: number;
  /** 每米像素数 */
  ppm: number;
  /** 运动进行中：禁止拖拽与编辑 */
  locked: boolean;
  onMove: (id: number, x: number) => void;
  onField: (id: number, field: SolveKey, value: number) => void;
  onSolve: (id: number, key: SolveKey) => void;
  onPatch: (id: number, patch: Partial<Runway>) => void;
  onVehicle: (id: number, vehicle: string) => void;
  onMeasure: (id: number, dist: number, dur: number) => void;
}) {
  const t = useTranslations("tools.motion");
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [dragFacingRight, setDragFacingRight] = useState<boolean | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<"head" | "vehicle">("head");
  const headInputRef = useRef<HTMLInputElement>(null);
  const vehicleInputRef = useRef<HTMLInputElement>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (locked) stopDrag.current?.();
    return () => stopDrag.current?.();
  }, [locked]);

  const headPress = useLongPress({
    onClick: () => headInputRef.current?.click(), onLongPress: () => onPatch(runway.id, { head: DEFAULT_HEAD }), disabled: locked,
  });
  const vehiclePress = useLongPress({ onLongPress: () => onPatch(runway.id, { vehicle: EMPTY_VEHICLE }), disabled: locked });
  const charX = POST_PAD + runway.x * ppm;
  const flip = !(dragFacingRight ?? runway.facingRight);

  /** 仅位置读数手柄起拖；临时转身独立于箭头设定的出发方向，松手恢复。 */
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (locked || event.button !== 0 || event.isPrimary === false || stopDrag.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    const { pointerId, clientX } = event;
    const drag = { lastX: clientX, x: runway.x, moved: false, startedAt: performance.now() };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (!drag.moved) {
        if (Math.abs(next.clientX - clientX) <= CHARACTER_DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        drag.startedAt = performance.now();
      }
      if (next.clientX !== drag.lastX) setDragFacingRight(next.clientX > drag.lastX);
      drag.lastX = next.clientX;
      drag.x = Math.max(0, Math.min(length, runway.x + (next.clientX - clientX) / ppm));
      onMove(runway.id, drag.x);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cleanup);
      stopDrag.current = null;
      setDragFacingRight(null);
    };
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      move(next);
      cleanup();
      const distance = Math.abs(drag.x - runway.x);
      const duration = (performance.now() - drag.startedAt) / 1000;
      if (drag.moved && distance > 0.2 && duration > 0.05) onMeasure(runway.id, distance, duration);
    };
    const cancel = (next: PointerEvent) => { if (next.pointerId === pointerId) cleanup(); };
    stopDrag.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cleanup);
  };

  const fields: { key: SolveKey; label: string; unit: string }[] = [
    { key: "distance", label: t("distance"), unit: "m" },
    { key: "time", label: t("time"), unit: "s" },
    { key: "speed", label: t("speed"), unit: "m/s" },
  ];

  return (
    <div className="flex items-stretch border-b border-line/70 py-2">
      <div className="flex shrink-0 flex-col justify-center gap-1.5 pr-3" style={{ width: PANEL_W }}>
        {fields.map(({ key, label, unit }) => {
          const solved = runway.solve === key;
          const resetValue = key === "distance" ? length : 0;
          return (
            <div key={key} className="flex items-center gap-1.5">
              <Button type="button" variant="ghost" disabled={locked} title={t("solveHint")}
                aria-label={`${label} · ${t("auto")}`} aria-pressed={solved}
                onClick={() => onSolve(runway.id, key)}
                className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-full border-[1.5px] border-crater p-0">
                {solved && <span className="size-2 rounded-full bg-rose" />}
              </Button>
              <span className="w-9 shrink-0 text-xs text-muted">{label}</span>
              <div className={cn("relative", solved && "rounded-md ring-1 ring-rose")}>
                <EditableNumber value={runway[key]} disabled={locked}
                  onCommit={(value) => onField(runway.id, key, value)}
                  ariaLabel={label}
                  longPressValue={resetValue} longPressLabel={t("numberHint", { value: resetValue, unit })} />
                {solved && <span className="pointer-events-none absolute -top-1.5 right-1 rounded-sm bg-rose px-0.5 text-[8px] leading-3 text-white">{t("auto")}</span>}
              </div>
              <span className="text-[10px] text-muted">{unit}</span>
            </div>
          );
        })}
      </div>

      <div className="relative min-h-[124px] flex-1">
        <div aria-hidden className="absolute" style={{ left: POST_PAD - 2, right: POST_PAD - 2, bottom: 14, height: 20 }}>
          <div className="h-full rounded-md border border-crater/50 bg-moon/25" />
          <div className="absolute inset-x-2 top-1/2 border-t border-dashed border-crater/60" />
        </div>
        <div aria-hidden className="absolute bottom-3 w-[2.5px] rounded-full bg-crater" style={{ left: POST_PAD - 2, height: 56 }} />
        <div aria-hidden className="absolute bottom-3 w-[2.5px] rounded-full bg-crater" style={{ right: POST_PAD - 2, height: 56 }} />

        {/* 旧版三段造型：前两段只处理点击/长按；播放锁定时保持教学对象的原色与不透明度。 */}
        <div className="absolute bottom-7 z-10 flex w-12 -translate-x-1/2 flex-col items-center select-none"
          style={{ left: charX }} onDragStart={(event) => event.preventDefault()}>
          <Button {...headPress} type="button" variant="ghost" disabled={locked}
            aria-label={t("avatar")} title={t("avatarHint")}
            className="size-12 shrink-0 touch-none overflow-hidden rounded-full bg-card bg-cover bg-center p-0 transition-none disabled:opacity-100"
            style={{ backgroundImage: `url(${runway.head})`, transform: flip ? "scaleX(-1)" : undefined, WebkitTouchCallout: "none" }} />

          <Popover open={!locked && vehicleOpen} onOpenChange={setVehicleOpen}>
            <PopoverTrigger asChild>
              <Button {...vehiclePress} type="button" variant="ghost" disabled={locked}
                aria-label={t("chooseVehicle")} title={t("vehicleHint")}
                className="h-6 w-12 shrink-0 touch-none rounded-none bg-card p-0 transition-none disabled:opacity-100"
                style={{ transform: flip ? "scaleX(-1)" : undefined, WebkitTouchCallout: "none" }}>
                <Image src={runway.vehicle} alt="" width={48} height={24} unoptimized draggable={false} className="h-6 w-12 object-contain" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" sideOffset={-96} collisionPadding={12} aria-label={t("chooseVehicle")}
              className="size-48 rounded-full border-0 bg-transparent p-0 shadow-none data-[state=open]:animate-none data-[state=closed]:animate-none"
              onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
              {VEHICLES.map((vehicle, index) => (
                <Button key={vehicle} type="button" variant="ghost" disabled={locked}
                  aria-label={t(`vehicles.${VEHICLE_NAMES[index]}`)} aria-pressed={runway.vehicle === vehicle}
                  title={`${t(`vehicles.${VEHICLE_NAMES[index]}`)} · ${VEHICLE_SPEEDS[vehicle]} m/s`}
                  onClick={() => onVehicle(runway.id, vehicle)} style={menuPosition(index)}
                  className={cn("absolute left-1/2 top-1/2 size-10 rounded-full border bg-card p-0 hover:bg-moon", runway.vehicle === vehicle && "border-rose")}>
                  <Image src={vehicle} alt="" width={40} height={20} unoptimized draggable={false} className="h-5 w-10 object-contain" />
                </Button>
              ))}
              <Button type="button" variant="ghost" disabled={locked} aria-label={t("uploadImage")} title={t("uploadImage")}
                onClick={() => vehicleInputRef.current?.click()} style={menuPosition(7)}
                className="absolute left-1/2 top-1/2 size-10 rounded-full border border-dashed bg-card p-0 hover:bg-moon">
                <ImageUp size={20} strokeWidth={1.75} />
              </Button>
              <div className="absolute left-1/2 top-[106px] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-card px-1 py-0.5">
                <Button type="button" variant="ghost" disabled={locked} aria-label={`${t("flip")} ←`} aria-pressed={!runway.facingRight}
                  onClick={() => onPatch(runway.id, { facingRight: false })}
                  className={cn("size-5 p-0", !runway.facingRight ? "text-rose" : "text-crater hover:text-ink")}>
                  <Play size={11} className="rotate-180 fill-current" />
                </Button>
                <NumField value={fmt(runway.x)} disabled={locked} autoFocus
                  onCommit={(value) => onMove(runway.id, Math.max(0, Math.min(length, value)))} className="w-12" ariaLabel={t("position")} />
                <Button type="button" variant="ghost" disabled={locked} aria-label={`${t("flip")} →`} aria-pressed={runway.facingRight}
                  onClick={() => onPatch(runway.id, { facingRight: true })}
                  className={cn("size-5 p-0", runway.facingRight ? "text-rose" : "text-crater hover:text-ink")}>
                  <Play size={11} className="fill-current" />
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Button type="button" variant="ghost" disabled={locked} role="slider" aria-label={t("dragHandle")}
            aria-valuemin={0} aria-valuemax={length} aria-valuenow={fmt(runway.x)} aria-valuetext={`${fmt(runway.x)} m`} aria-orientation="horizontal"
            title={t("dragHandle")} onPointerDown={startDrag} onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const step = event.shiftKey ? 0.1 : 1;
              onMove(runway.id, fmt(Math.max(0, Math.min(length, runway.x + (event.key === "ArrowRight" ? step : -step)))));
            }}
            className="h-6 w-12 shrink-0 cursor-grab touch-none rounded-none bg-card p-0 text-xs tabular-nums text-ink active:cursor-grabbing disabled:opacity-100">
            {fmt(runway.x)}
          </Button>
        </div>

        <Input ref={headInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { readImageFile(e.target.files?.[0], (url) => { setCropTarget("head"); setCropSrc(url); }); e.target.value = ""; }} />
        <Input ref={vehicleInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { readImageFile(e.target.files?.[0], (url) => { setVehicleOpen(false); setCropTarget("vehicle"); setCropSrc(url); }); e.target.value = ""; }} />

        <ImageCropDialog key={cropSrc ?? "none"} src={cropSrc} shape={cropTarget === "head" ? "round" : "rect"}
          aspect={cropTarget === "head" ? 1 : 2} title={t("cropTitle")} zoomLabel={t("cropZoom")}
          cancelLabel={t("cancel")} confirmLabel={t("apply")} onCancel={() => setCropSrc(null)}
          onConfirm={(dataUrl) => { onPatch(runway.id, cropTarget === "head" ? { head: dataUrl } : { vehicle: dataUrl }); setCropSrc(null); }} />
      </div>
    </div>
  );
}
