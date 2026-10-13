import { createEmptyCoursewareCompositionPage, type CoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { createCoursewareInsertedNode } from "@/features/courseware-doc/courseware-inserted-node";
import { formalManualPageSchema } from "@/features/courseware-studio/formal-manual-page-contract";
import { validateGameCoursewareContent } from "@/features/games/courseware/server";
import { sudokuVariantPayloadSchema, type SudokuVariantPayload } from "@/features/games/sudoku/courseware-contract";
import { getSudokuVariant, type SudokuSize, type SudokuVariantId } from "@/features/games/sudoku/variant";
import { sudokuRulesValid, type SudokuVariantRules } from "@/features/games/sudoku/rules";
import { forcedSudokuCellValue } from "@/features/games/sudoku/logic";
import { createCubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";
import { cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { createCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";
import { CUBE_COLORS } from "@/features/tools/spatial-lab/cube-structures-contract";
import { CUBE_TOOLBAR_GROUPS } from "@/features/tools/spatial-lab/cube-structures-toolbar";

type Target = { index: number; value: number };
type Puzzle = { id: string; lessonId: string; pageKey: string; role: "discover" | "target" | "class" | "homework"; size: SudokuSize; family: string; puzzle: number[]; solution: number[]; rules: SudokuVariantRules; targets: Target[]; words: Record<string, string | number> };
type Notes = { ask: string[]; expect: string; watch: string } | null;
export type PlanPage = { key: string; kind: string; title: string; heading?: string; prompt?: string; tag?: string; name?: string; body?: string; tip?: string; sub?: string; goal?: string; reuse?: string; minutes?: number; role?: string; heights?: number[]; notes?: Notes; puzzle?: unknown };
export type PlanLesson = { id: string; level: string; grades: string; n: SudokuSize; number: number; title: string; goal: string; pages: PlanPage[] };
type Bank = { title: string; puzzles: Puzzle[] };
export type NativePage = { key: string; title: string; kind: string; puzzleId: string | null; doc: CoursewareCompositionPage };
export type NativeLesson = { id: string; level: string; grades: string; n: SudokuSize; number: number; title: string; goal: string; pages: NativePage[] };

const C = { paper: "#fffdf7", ink: "#243d38", accent: "#a35a31", muted: "#5f6f6a" };
const CJK = /[㐀-鿿]/;

/** Fill {digit}, {box}… from the proved puzzle, spacing Latin coordinates from Chinese text. */
export function fillWords(template: string, words: Record<string, string | number>, id: string): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string, offset: number, source: string) => {
    if (words[key] === undefined) throw new Error(`${id}: missing ${key}`);
    let value = String(words[key]);
    if (CJK.test(source[offset - 1] ?? "") && /^[A-Za-z0-9]/.test(value)) value = ` ${value}`;
    if (CJK.test(source[offset + match.length] ?? "") && /[A-Za-z0-9]$/.test(value)) value = `${value} `;
    return value;
  });
}

type TextStyle = { size: number; weight?: number; color?: string; align?: "left" | "center" | "right"; lineHeight?: number };
function addText(doc: CoursewareCompositionPage, id: string, text: string, [column, row, columnSpan, rowSpan]: number[], style: TextStyle) {
  const node = createCoursewareInsertedNode("text", doc.overlay.nodes.length, doc.canvas, id);
  node.content = { kind: "text", text };
  node.transform = { ...node.transform, x: column * 80 + 16, y: row * 80 + 12, width: columnSpan * 80 - 32, height: rowSpan * 80 - 24 };
  node.style = { ...node.style, fontSize: style.size, fontWeight: style.weight ?? 400, color: style.color ?? C.ink, textAlign: style.align ?? "left", lineHeight: style.lineHeight ?? 1.5, whiteSpace: "pre-wrap" };
  doc.overlay.nodes.push(node);
  doc.layout.blocks.push({ id: `tile-${id}`, type: "node", nodeId: id, placement: { column, row, columnSpan, rowSpan } });
}
function blank(heading?: string) {
  const doc = createEmptyCoursewareCompositionPage();
  doc.canvas.backgroundColor = C.paper;
  if (heading) addText(doc, "heading", heading, [0, 0, 12, 1], { size: 34, weight: 700 });
  return doc;
}

function payloadFor(p: Puzzle, mode: "discover" | "target" | "full"): SudokuVariantPayload {
  const n = p.size;
  return sudokuVariantPayloadSchema.parse({
    kind: "authored-variant", variantId: `${p.family}-${n}x${n}` as SudokuVariantId, puzzle: p.puzzle, rules: p.rules,
    goal: mode === "discover" ? { kind: "teacher-led" } : mode === "target" ? { kind: "teaching-target", targets: p.targets.map((t) => ({ kind: "cell-value", ...t })) } : { kind: "full-solution", requireUnique: true },
    display: { showCoordinates: true, allowCandidates: n !== 4 && mode !== "discover", allowAnswerReveal: mode !== "discover", showTeachingTools: true },
  });
}
function addGame(doc: CoursewareCompositionPage, payload: SudokuVariantPayload, id: string) {
  const trusted = validateGameCoursewareContent("sudoku", "sudoku-authored-v3", payload);
  if (!trusted.validation.publishable) throw new Error(`${id}: ${trusted.validation.code}`);
  doc.layout.blocks.push({ id: "sudoku", type: "game", placement: { column: 0, row: 1, columnSpan: 8, rowSpan: 8 }, game: { docVersion: "game-page-v1", canvas: { width: 960, height: 720, backgroundColor: null }, gameId: "sudoku", contentVersion: "sudoku-authored-v3", ...trusted } });
}
function sideText(doc: CoursewareCompositionPage, prompt: string, tag: string | undefined) {
  addText(doc, "prompt", prompt, [8, 1, 4, 6], { size: 26, lineHeight: 1.6 });
  if (tag) addText(doc, "tag", tag, [8, 7, 4, 2], { size: 24, weight: 700, color: C.accent });
}

function towersDoc(heights: number[]) {
  const doc = blank("先搭一排楼，再换边看看");
  const cubes = heights.flatMap((height, i) => Array.from({ length: height }, (_, y) => ({ x: i * 2, y, z: 0 })));
  const session = createCubeSession(cubes);
  // Height colours stay fixed (1 blue, 2 red, 3 green, 4 purple) so both arrangements compare by building.
  const towerColors = [CUBE_COLORS[3], CUBE_COLORS[1], CUBE_COLORS[0], CUBE_COLORS[4]];
  const initial = { ...session.work.initial, axesVisible: false, hiddenEdgesVisible: false, cubes: session.work.initial.cubes.map((cube) => ({ ...cube, color: towerColors[heights[cube.position.x / 2] - 1] })) };
  const tool = createCubeCoursewareTool({ name: `楼高 ${heights.join("、")}`, snapshot: cubeDraftSnapshot({ ...session, work: { ...session.work, initial } }, 0) }, "current", [...CUBE_TOOLBAR_GROUPS[0].tools, "undo", "redo", "reset"]);
  doc.layout.blocks.push({ id: "towers", type: "tool", tool, placement: { column: 0, row: 1, columnSpan: 8, rowSpan: 8 } });
  sideText(doc, `楼高 ${heights.join("、")}\n先猜：从左边、右边\n各能看到几栋？\n点左视、右视验证。`, "数楼栋，不数积木");
  return doc;
}

function pageDoc(lesson: PlanLesson, page: PlanPage, puzzle: Puzzle | null): CoursewareCompositionPage {
  const words = puzzle?.words ?? {};
  const fill = (text?: string) => fillWords(text ?? "", words, `${lesson.id}-${page.key}`);
  switch (page.kind) {
    case "opening": {
      const doc = blank();
      addText(doc, "title", lesson.title, [1, 2, 10, 2], { size: 60, weight: 700, align: "center" });
      addText(doc, "sub", page.sub!, [1, 4, 10, 1], { size: 30, color: C.muted, align: "center" });
      addText(doc, "goal", page.goal!, [1, 6, 10, 2], { size: 34, weight: 700, color: C.accent, align: "center" });
      return doc;
    }
    case "card": {
      const doc = blank(page.heading);
      addText(doc, "name", page.name!, [1, 1, 10, 2], { size: 46, weight: 700, color: C.accent, align: "center" });
      addText(doc, "body", page.body!, [1, 3, 10, 4], { size: 32, lineHeight: 1.7 });
      if (page.tip) addText(doc, "tip", page.tip, [1, 7, 10, 2], { size: 26, color: C.muted });
      return doc;
    }
    case "summary": {
      const doc = blank(page.heading);
      addText(doc, "body", page.body!, [1, 1, 10, 5], { size: 30, lineHeight: 1.75 });
      addText(doc, "prompt", page.prompt!.replaceAll("\n", ""), [1, 6, 10, 2], { size: 30, weight: 700, color: C.accent });
      return doc;
    }
    case "break": {
      const doc = blank("休息 5 分钟");
      addText(doc, "body", "起身活动，看看远处。\n回来后，完成属于自己的挑战。", [1, 2, 10, 3], { size: 38, align: "center", lineHeight: 1.7 });
      addText(doc, "tip", "先想好：我准备按什么顺序找数？", [1, 6, 10, 2], { size: 30, color: C.accent, align: "center" });
      return doc;
    }
    case "tool": return towersDoc(page.heights!);
    case "discover": case "target": case "recap": case "full": {
      const doc = blank(fill(page.heading));
      addGame(doc, payloadFor(puzzle!, page.kind === "discover" ? "discover" : page.kind === "full" ? "full" : "target"), `${lesson.id}-${page.key}`);
      sideText(doc, fill(page.prompt), page.tag);
      return doc;
    }
    default: throw new Error(`${lesson.id}-${page.key}: unknown page kind ${page.kind}`);
  }
}

/** Every puzzle passes the application validator and the native engine before any page is built. */
function nativeAudit(bank: Bank, previous?: Array<{ id: string; payloadHash: string }>) {
  const audit: unknown[] = [];
  for (const p of bank.puzzles) {
    const mode = p.role === "discover" ? "discover" : p.role === "target" ? "target" : "full";
    const payload = payloadFor(p, mode), variant = { ...getSudokuVariant(payload.variantId)!, rules: payload.rules };
    if (!sudokuRulesValid(variant)) throw new Error(`${p.id}: invalid native rules`);
    const checked = validateGameCoursewareContent("sudoku", "sudoku-authored-v3", payload);
    if (!checked.validation.publishable) throw new Error(`${p.id}: native validator ${checked.validation.code}`);
    const reused = previous?.some((a) => a.id === p.id && a.payloadHash === checked.validation.payloadHash);
    if (!reused && mode === "target") for (const t of p.targets) {
      if (forcedSudokuCellValue(p.puzzle, t.index, variant) !== t.value) throw new Error(`${p.id}: native engine does not force ${t.index}`);
    }
    if (!reused && mode === "full") {
      const details = checked.validation.details as { puzzle: { solution: number[] } };
      if (JSON.stringify(details.puzzle.solution) !== JSON.stringify(p.solution)) throw new Error(`${p.id}: native solution differs`);
    }
    audit.push({ id: p.id, variantId: payload.variantId, code: checked.validation.code, payloadHash: checked.validation.payloadHash });
  }
  return audit;
}

export function buildNativeCourse(plan: PlanLesson[], bank: Bank, previous?: Array<{ id: string; payloadHash: string }>) {
  const audit = nativeAudit(bank, previous);
  const lessons = plan.map((lesson): NativeLesson => ({
    id: lesson.id, level: lesson.level, grades: lesson.grades, n: lesson.n, number: lesson.number, title: lesson.title, goal: lesson.goal,
    pages: lesson.pages.map((page) => {
      const puzzleId = page.kind === "recap" ? `${lesson.id}-${page.reuse}` : page.puzzle ? `${lesson.id}-${page.key}` : null;
      const puzzle = puzzleId ? bank.puzzles.find((p) => p.id === puzzleId) ?? null : null;
      if (puzzleId && !puzzle) throw new Error(`${puzzleId}: missing from bank`);
      return { key: page.key, title: page.title, kind: page.kind, puzzleId, doc: formalManualPageSchema.parse(pageDoc(lesson, page, puzzle)) };
    }),
  }));
  return { title: bank.title, lessons, nativeAudit: audit };
}
