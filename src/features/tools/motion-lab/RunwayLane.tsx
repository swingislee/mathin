"use client";

import { Input } from "@/components/ui/input";

import { ImageUp, Play, RotateCcw } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { ImageCropDialog } from "@/components/image-crop-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { NumField } from "./NumField";
import { DEFAULT_HEAD, DEFAULT_VEHICLE, PANEL_W, POST_PAD, VEHICLES, VEHICLE_SPEEDS, fmt, type Runway, type SolveKey } from "./shared";

function readImageFile(file: File | undefined, cb: (dataUrl: string) => void) {
  if (!file) return;
  const reader = new FileReader();
  reader.onloadend = () => typeof reader.result === "string" && cb(reader.result);
  reader.readAsDataURL(file);
}

const LONG_PRESS_MS = 550;

export function RunwayLane({ runway, length, ppm, locked, onMove, onField, onFieldFocus, onSolve, onPatch, onVehicle, onMeasure }: {
  runway: Runway;
  length: number;
  /** 每米像素数 */
  ppm: number;
  /** 运动进行中：禁止拖拽与编辑 */
  locked: boolean;
  onMove: (id: number, x: number) => void;
  onField: (id: number, field: SolveKey, value: number) => void;
  /** 聚焦「自动」字段时立即轮转求解目标（原版手感） */
  onFieldFocus: (id: number, field: SolveKey) => void;
  onSolve: (id: number, key: SolveKey) => void;
  onPatch: (id: number, patch: Partial<Runway>) => void;
  onVehicle: (id: number, vehicle: string) => void;
  onMeasure: (id: number, dist: number, dur: number) => void;
}) {
  const t = useTranslations("tools.motion");
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [editingPos, setEditingPos] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<"head" | "vehicle">("head");
  const headInputRef = useRef<HTMLInputElement>(null);
  const vehicleInputRef = useRef<HTMLInputElement>(null);
  const movedRef = useRef(false);
  const longFiredRef = useRef(false);
  const pressTimerRef = useRef<number | null>(null);

  const charX = POST_PAD + runway.x * ppm;
  const flip = !runway.facingRight;

  /** 长按 = 恢复默认（原版交互）；拖动会取消长按 */
  const beginPress = (onLong: () => void) => {
    longFiredRef.current = false;
    pressTimerRef.current = window.setTimeout(() => {
      if (!movedRef.current) {
        longFiredRef.current = true;
        onLong();
      }
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
  };

  /** 角色拖拽：window 级监听，不做指针捕获，避免吞掉头像/载具/位置的点击 */
  const startDrag = (e: React.PointerEvent) => {
    if (locked || editingPos) return;
    movedRef.current = false;
    const d = { pointerX: e.clientX, lastX: e.clientX, x0: runway.x, t0: performance.now() };
    const onMoveW = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - d.pointerX) > 3) movedRef.current = true;
      if (ev.clientX - d.lastX > 2 && !runway.facingRight) onPatch(runway.id, { facingRight: true });
      if (ev.clientX - d.lastX < -2 && runway.facingRight) onPatch(runway.id, { facingRight: false });
      d.lastX = ev.clientX;
      onMove(runway.id, Math.max(0, Math.min(length, d.x0 + (ev.clientX - d.pointerX) / ppm)));
    };
    const onUpW = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMoveW);
      const nx = Math.max(0, Math.min(length, d.x0 + (ev.clientX - d.pointerX) / ppm));
      const dist = Math.abs(nx - d.x0);
      const dur = (performance.now() - d.t0) / 1000;
      if (movedRef.current && dist > 0.2 && dur > 0.05) onMeasure(runway.id, dist, dur);
    };
    window.addEventListener("pointermove", onMoveW);
    window.addEventListener("pointerup", onUpW, { once: true });
  };

  const fields: { key: SolveKey; label: string; unit: string }[] = [
    { key: "distance", label: t("distance"), unit: "m" },
    { key: "time", label: t("time"), unit: "s" },
    { key: "speed", label: t("speed"), unit: "m/s" },
  ];

  return (
    <div className="flex items-stretch border-b border-line/70 py-2">
      {/* 路程/时间/速度：全部可编辑，被求解的量高亮为「自动」；聚焦即轮转 */}
      <div className="flex shrink-0 flex-col justify-center gap-1.5 pr-3" style={{ width: PANEL_W }}>
        {fields.map(({ key, label, unit }) => {
          const solved = runway.solve === key;
          return (
            <div key={key} className="flex items-center gap-1.5">
              <button
                type="button"
                title={t("solveHint")}
                aria-label={t("solveHint")}
                onClick={() => onSolve(runway.id, key)}
                className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-full border-[1.5px] border-crater"
              >
                {solved && <span className="size-2 rounded-full bg-rose" />}
              </button>
              <span className="w-9 shrink-0 text-xs text-muted">{label}</span>
              <div className={cn("relative", solved && "rounded-md ring-1 ring-rose")}>
                <NumField
                  value={runway[key]}
                  disabled={locked}
                  onCommit={(v) => onField(runway.id, key, v)}
                  onFocusField={() => onFieldFocus(runway.id, key)}
                  ariaLabel={label}
                />
                {solved && (
                  <span className="absolute -top-1.5 right-1 rounded-sm bg-rose px-0.5 text-[8px] leading-3 text-white">{t("auto")}</span>
                )}
              </div>
              <span className="text-[10px] text-muted">{unit}</span>
            </div>
          );
        })}
      </div>

      {/* 跑道 */}
      <div className="relative min-h-[124px] flex-1">
        {/* 跑道条 */}
        <div aria-hidden className="absolute" style={{ left: POST_PAD - 2, right: POST_PAD - 2, bottom: 14, height: 20 }}>
          <div className="h-full rounded-md border border-crater/50 bg-moon/25" />
          <div className="absolute inset-x-2 top-1/2 border-t border-dashed border-crater/60" />
        </div>
        {/* 起终点柱 */}
        <div aria-hidden className="absolute bottom-3 w-[2.5px] rounded-full bg-crater" style={{ left: POST_PAD - 2, height: 56 }} />
        <div aria-hidden className="absolute bottom-3 w-[2.5px] rounded-full bg-crater" style={{ right: POST_PAD - 2, height: 56 }} />

        {/* 角色：头像（点击上传+裁剪/长按复位）+ 载具（点击弹窗换乘/长按复位）+ ◀位置▶ */}
        <div
          className={cn(
            "absolute bottom-7 z-10 flex -translate-x-1/2 touch-none flex-col items-center select-none",
            locked ? "cursor-default" : "cursor-grab active:cursor-grabbing",
          )}
          style={{ left: charX }}
          onPointerDown={startDrag}
        >
          <button
            type="button"
            aria-label={t("avatar")}
            onPointerDown={() => beginPress(() => onPatch(runway.id, { head: DEFAULT_HEAD }))}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onClick={() => {
              if (!movedRef.current && !longFiredRef.current) headInputRef.current?.click();
            }}
            className="size-12 overflow-hidden rounded-full bg-cover bg-center"
            style={{ backgroundImage: `url(${runway.head})`, transform: flip ? "scaleX(-1)" : undefined }}
          />
          <button
            type="button"
            aria-label={t("chooseVehicle")}
            onPointerDown={() => beginPress(() => onPatch(runway.id, { vehicle: DEFAULT_VEHICLE }))}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onClick={() => {
              if (!movedRef.current && !longFiredRef.current) setVehicleOpen(true);
            }}
            className="h-8 w-16"
            style={{ transform: flip ? "scaleX(-1)" : undefined }}
          >
            <Image src={runway.vehicle} alt="" width={64} height={32} unoptimized className="h-8 w-16 object-contain" />
          </button>

          {/* ◀ 位置 ▶：三角原地换向；点击数字直接输入位置 */}
          <div className="mt-1 flex items-center gap-1">
            <button
              type="button"
              aria-label={`${t("flip")} ←`}
              onClick={() => onPatch(runway.id, { facingRight: false })}
              className={cn("grid size-5 place-items-center transition-colors duration-200", !runway.facingRight ? "text-rose" : "text-crater hover:text-ink")}
            >
              <Play size={11} className="rotate-180 fill-current" />
            </button>
            {editingPos ? (
              <NumField
                value={fmt(runway.x)}
                onCommit={(v) => {
                  onMove(runway.id, Math.max(0, Math.min(length, v)));
                  setEditingPos(false);
                }}
                className="w-14"
                ariaLabel={t("position")}
              />
            ) : (
              <button
                type="button"
                title={t("position")}
                onClick={() => {
                  if (!movedRef.current) setEditingPos(true);
                }}
                className="rounded-full border border-line bg-card/90 px-2 py-0.5 text-xs tabular-nums text-ink"
              >
                {fmt(runway.x)} m
              </button>
            )}
            <button
              type="button"
              aria-label={`${t("flip")} →`}
              onClick={() => onPatch(runway.id, { facingRight: true })}
              className={cn("grid size-5 place-items-center transition-colors duration-200", runway.facingRight ? "text-rose" : "text-crater hover:text-ink")}
            >
              <Play size={11} className="fill-current" />
            </button>
          </div>
        </div>

        <Input ref={headInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { readImageFile(e.target.files?.[0], (url) => { setCropTarget("head"); setCropSrc(url); }); e.target.value = ""; }} />
        <Input ref={vehicleInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { readImageFile(e.target.files?.[0], (url) => { setVehicleOpen(false); setCropTarget("vehicle"); setCropSrc(url); }); e.target.value = ""; }} />

        {/* 载具选择：固定居中弹窗（不再随角色位置被遮挡） */}
        <Dialog open={vehicleOpen} onOpenChange={setVehicleOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("chooseVehicle")}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {VEHICLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    onVehicle(runway.id, v);
                    setVehicleOpen(false);
                  }}
                  className={cn("flex flex-col items-center gap-1 rounded-xl border p-2 transition duration-200 hover:-translate-y-0.5 hover:bg-moon/40", runway.vehicle === v && "border-rose")}
                >
                  <Image src={v} alt="" width={80} height={40} unoptimized className="h-10 w-20 object-contain" />
                  <span className="text-[10px] tabular-nums text-muted">{VEHICLE_SPEEDS[v]} m/s</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => vehicleInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-2 text-muted transition duration-200 hover:-translate-y-0.5 hover:bg-moon/40 hover:text-ink"
              >
                <ImageUp size={20} strokeWidth={1.75} />
                <span className="text-[10px]">{t("uploadImage")}</span>
              </button>
            </div>
            <DialogFooter>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onPatch(runway.id, { head: DEFAULT_HEAD, vehicle: DEFAULT_VEHICLE });
                  setVehicleOpen(false);
                }}
              >
                <RotateCcw size={13} />{t("resetImage")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 上传裁剪：头像圆形 1:1，载具矩形 2:1 */}
        <ImageCropDialog
          key={cropSrc ?? "none"}
          src={cropSrc}
          shape={cropTarget === "head" ? "round" : "rect"}
          aspect={cropTarget === "head" ? 1 : 2}
          title={t("cropTitle")}
          zoomLabel={t("cropZoom")}
          cancelLabel={t("cancel")}
          confirmLabel={t("apply")}
          onCancel={() => setCropSrc(null)}
          onConfirm={(dataUrl) => {
            onPatch(runway.id, cropTarget === "head" ? { head: dataUrl } : { vehicle: dataUrl });
            setCropSrc(null);
          }}
        />
      </div>
    </div>
  );
}
