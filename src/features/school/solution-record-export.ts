"use client";

const EXPORT_WIDTH = 1920;
const EXPORT_HEIGHT = 1440;
const WEBP_QUALITY = 0.82;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForPreview(target: HTMLElement): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (!target.querySelector('[data-stage-mode="board43"]')) {
    if (performance.now() >= deadline) throw new Error("SOLUTION_PREVIEW_NOT_READY");
    await nextFrame();
  }
  await document.fonts.ready;
  await Promise.all(
    [...target.querySelectorAll("img")].map((image) =>
      image.complete ? image.decode().catch(() => undefined) : new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      }),
    ),
  );
  await nextFrame();
  await nextFrame();
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("SOLUTION_EXPORT_EMPTY")),
      "image/webp",
      WEBP_QUALITY,
    );
  });
}

export async function exportSolutionRecordWebp(target: HTMLElement, fileName: string): Promise<void> {
  await waitForPreview(target);
  const { toCanvas } = await import("html-to-image");
  const backgroundColor = getComputedStyle(target).backgroundColor || "#fff";
  const canvas = await toCanvas(target, {
    backgroundColor,
    canvasWidth: EXPORT_WIDTH,
    canvasHeight: EXPORT_HEIGHT,
    includeQueryParams: true,
    pixelRatio: 1,
  });
  const blob = await canvasBlob(canvas);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName || "solution"}.webp`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
