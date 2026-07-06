"use client";

import { useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { getCroppedImage } from "@/lib/crop-image";

/**
 * 通用图片裁剪弹窗：shadcn Dialog + react-easy-crop。
 * shape="round" 圆形（头像）、"rect" 矩形（按 aspect，如载具 2:1）。
 */
export function ImageCropDialog({ src, shape, aspect, title, zoomLabel, cancelLabel, confirmLabel, onCancel, onConfirm }: {
  /** 为 null 时关闭 */
  src: string | null;
  shape: "round" | "rect";
  aspect: number;
  title: string;
  zoomLabel: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);

  const confirm = async () => {
    if (!src || !area) return;
    onConfirm(await getCroppedImage(src, area));
  };

  return (
    <Dialog open={!!src} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="relative h-72 w-full overflow-hidden rounded-xl border bg-paper">
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              cropShape={shape === "round" ? "round" : "rect"}
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, areaPixels) => setArea(areaPixels)}
            />
          )}
        </div>
        <label className="flex items-center gap-3 text-xs text-muted">
          {zoomLabel}
          <Slider value={[zoom]} min={1} max={4} step={0.01} onValueChange={([v]) => setZoom(v)} className="flex-1" aria-label={zoomLabel} />
        </label>
        <DialogFooter className="gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>{cancelLabel}</Button>
          <Button size="sm" onClick={confirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
