// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync(
  resolve("public/design-previews/plane-geometry-teaching-spaces.html"),
  "utf8",
);
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const storageKey = "mathin-plane-geometry-review-2026-09-26-v1";

function mount() {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  if (!script) throw new Error("Standalone review script is missing");
  new Function(script)();
}

function progress(id: string, value: number) {
  const input = document.querySelector<HTMLInputElement>(`[data-progress="${id}"]`)!;
  input.value = String(value);
  input.dispatchEvent(new Event("input"));
}

function area(polygon: Element) {
  const points = polygon.getAttribute("points")!.split(" ").map((p) => p.split(",").map(Number));
  return Math.abs(points.reduce((sum, [x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length];
    return sum + x * ny - nx * y;
  }, 0)) / 2;
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  mount();
});

describe("standalone plane geometry review", () => {
  it("lists 60 illustrated scenes with seven proposed entrances and resolvable sources", () => {
    const cards = [...document.querySelectorAll(".scene")];
    expect(cards).toHaveLength(60);
    expect(document.querySelectorAll(".tool-link")).toHaveLength(7);
    for (const card of cards) {
      expect(card.querySelector('svg[role="img"] title')?.textContent).toBeTruthy();
      expect(card.querySelectorAll("svg > polygon, svg > path, svg > line, svg > rect, svg > circle, svg > g").length).toBeGreaterThan(1);
      expect(card.querySelectorAll(".proposal dd")).toHaveLength(3);
    }
    const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      expect(document.getElementById(link.getAttribute("href")!.slice(1))).not.toBeNull();
    }
    expect(document.querySelectorAll(".sources li")).toHaveLength(10);
    expect(document.querySelectorAll("script[src], iframe")).toHaveLength(0);
  });

  it("separates curriculum, extensions and Olympiad content without changing the catalog", () => {
    for (const [filter, count] of [["core", 31], ["extension", 5], ["olympiad", 24], ["all", 60]] as const) {
      document.querySelector<HTMLButtonElement>(`[data-filter="${filter}"]`)!.click();
      expect(document.querySelectorAll(".scene:not([hidden])")).toHaveLength(count);
    }
    const details = document.querySelector<HTMLInputElement>("#show-details")!;
    details.checked = false;
    details.dispatchEvent(new Event("change"));
    expect(document.querySelectorAll(".proposal[hidden]")).toHaveLength(60);
  });

  it("renders every process at start, middle and end with finite SVG coordinates", () => {
    for (const input of document.querySelectorAll<HTMLInputElement>("[data-progress]")) {
      const id = input.dataset.progress!;
      const frames = [0, 500, 1000].map((value) => {
        progress(id, value);
        const svg = document.querySelector(`#scene-${id} svg`)!;
        expect(svg.outerHTML).not.toMatch(/NaN|Infinity|undefined/);
        return svg.outerHTML;
      });
      expect(new Set(frames).size).toBe(3);
    }
    const pieces = document.querySelector<HTMLSelectElement>('[data-pieces="27"]')!;
    for (const n of [8, 16, 32]) {
      pieces.value = String(n);
      pieces.dispatchEvent(new Event("change"));
      expect(document.querySelectorAll("#scene-27 svg > g")).toHaveLength(n);
    }
  });

  it("preserves area in the illustrated cut-and-rearrange models", () => {
    for (const t of [0, 500, 1000]) {
      progress("14", t);
      const pieces = [...document.querySelectorAll("#scene-14 polygon.shape")];
      expect(pieces.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(180 * 80);
    }
    for (const id of ["15", "16", "58"]) {
      const areas = [...document.querySelectorAll(`#scene-${id} polygon.shape`)].map(area);
      for (const value of areas) expect(value).toBeCloseTo(areas[0]);
    }
    const tangram = [...document.querySelectorAll("#scene-02 svg > polygon")].map(area);
    expect(tangram.reduce((a, b) => a + b, 0)).toBeCloseTo(136 ** 2);
    expect(tangram.map((a) => a / 34 ** 2).sort()).toEqual([1, 1, 2, 2, 2, 4, 4]);
  });

  it("stores local review decisions and safely restores text without submitting data", () => {
    const decision = document.querySelector<HTMLSelectElement>('[data-review="39"]')!;
    decision.value = "adjust";
    decision.dispatchEvent(new Event("change"));
    const note = document.querySelector<HTMLTextAreaElement>('[data-note="39"]')!;
    const text = '</textarea><img src="x" onerror="alert(1)"> 希望保留共线条件';
    note.value = text;
    note.dispatchEvent(new Event("input"));
    expect(JSON.parse(localStorage.getItem(storageKey)!)["39"]).toEqual({ decision: "adjust", note: text });
    mount();
    expect(document.querySelector<HTMLTextAreaElement>('[data-note="39"]')!.value).toBe(text);
    expect(document.querySelectorAll("img")).toHaveLength(0);
    document.querySelector<HTMLButtonElement>('[data-filter="reviewed"]')!.click();
    expect(document.querySelectorAll(".scene:not([hidden])")).toHaveLength(1);
  });

  it("keeps animation explicitly controlled and stops hidden demonstrations", () => {
    const play = document.querySelector<HTMLButtonElement>('[data-play="14"]')!;
    play.click();
    expect(play.textContent).toBe("暂停");
    expect(play.getAttribute("aria-label")).toContain("暂停");
    document.querySelector<HTMLButtonElement>('[data-filter="olympiad"]')!.click();
    expect(play.textContent).toBe("播放");
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
  });
});
