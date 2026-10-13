import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("server-only", () => ({}));
import { createDefaultSudokuVariantPayload, sudokuActivityPayloadSchema, sudokuPayloadVariant, sudokuVariantPayloadSchema } from "@/features/games/sudoku/courseware-contract";
import { analyzeSudokuCoursewareActivity } from "@/features/games/sudoku/activity";
import { countSudokuSolutions, isSolvedGrid, solveSudokuGrid, forcedSudokuCellValue } from "@/features/games/sudoku/logic";
import { SUDOKU_WINDOW_ORIGINS, sudokuRulesValid, sudokuWindowCells } from "@/features/games/sudoku/rules";
import { chooseSudokuDigit, createSudokuBoardState, selectSudokuCell, setSudokuHighlightTool, sudokuHighlightRegions, toSudokuMirrorState } from "@/features/games/sudoku/state";
import { validateGameCoursewareContent } from "@/features/games/courseware/server";
import { formalManualPageSchema } from "@/features/courseware-studio/formal-manual-page-contract";
import { createEmptyCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { getSudokuVariant } from "@/features/games/sudoku/variant";

const classic = [1,2,3,4,3,4,1,2,2,1,4,3,4,3,2,1];
describe("authored native Sudoku variants", () => {
  it("keeps the legacy v2 payload family closed while v3 carries its rules", () => {
    const payload=createDefaultSudokuVariantPayload("diagonal-4x4");
    expect(sudokuVariantPayloadSchema.parse(payload)).toEqual(payload);
    expect(sudokuActivityPayloadSchema.safeParse({...payload,kind:"authored-activity",rules:undefined}).success).toBe(false);
    expect(sudokuVariantPayloadSchema.safeParse({...payload,rules:{kind:"classic"}}).success).toBe(false);
    expect(isSolvedGrid(classic,"classic-4x4")).toBe(true);
    expect(isSolvedGrid(classic,sudokuPayloadVariant(payload))).toBe(false);
    const solution=solveSudokuGrid(Array(16).fill(0),sudokuPayloadVariant(payload))!;
    expect(isSolvedGrid(solution,sudokuPayloadVariant(payload))).toBe(true);
  });
  it("checks inequality direction and odd/even marks in both partial and complete boards", () => {
    const less={...getSudokuVariant("inequality-4x4")!,rules:{kind:"inequality" as const,lessThan:[[0,1] as [number,number]]}};
    expect(isSolvedGrid(classic,less)).toBe(true);
    expect(isSolvedGrid(classic,{...less,rules:{kind:"inequality",lessThan:[[1,0]]}})).toBe(false);
    const cells=Array(16).fill(0); cells[0]=2;
    const parity={...getSudokuVariant("parity-4x4")!,rules:{kind:"parity" as const,cells}};
    expect(isSolvedGrid(classic,parity)).toBe(false);
    expect(forcedSudokuCellValue([0,2,3,4,...classic.slice(4)],0,parity)).toBeNull();
  });
  it("uses skyline clues without silently adding 2x2 boxes", () => {
    const payload=createDefaultSudokuVariantPayload("skyscraper-4x4");
    payload.rules={kind:"skyscraper",top:[4,3,2,1],bottom:[1,2,2,2],left:[4,3,2,1],right:[1,2,2,2]};
    const cyclic=[1,2,3,4,2,3,4,1,3,4,1,2,4,1,2,3];
    expect(isSolvedGrid(cyclic,"classic-4x4")).toBe(false);
    expect(isSolvedGrid(cyclic,sudokuPayloadVariant(payload))).toBe(true);
    payload.rules.top[0]=1;
    expect(isSolvedGrid(cyclic,sudokuPayloadVariant(payload))).toBe(false);
  });
  it("adds the four windoku windows as regions on 9x9 only", () => {
    const window=getSudokuVariant("window-9x9")!;
    const solution=solveSudokuGrid(Array(81).fill(0),window)!;
    expect(isSolvedGrid(solution,window)).toBe(true);
    for (const origin of SUDOKU_WINDOW_ORIGINS) expect(new Set(sudokuWindowCells(origin).map((i)=>solution[i])).size).toBe(9);
    const broken=[...solution]; [broken[10],broken[19]]=[broken[19],broken[10]];
    expect(isSolvedGrid(broken,window)).toBe(false);
    expect(sudokuRulesValid({...getSudokuVariant("classic-6x6")!,family:"window",rules:{kind:"window"}} as never)).toBe(false);
  });
  it("saves unfinished region drafts but rejects them as playable activities", () => {
    const payload=createDefaultSudokuVariantPayload("irregular-4x4");
    payload.rules={kind:"irregular",regions:Array.from({length:16},(_,i)=>i%4)};
    expect(sudokuRulesValid(sudokuPayloadVariant(payload))).toBe(true);
    payload.rules.regions[0]=1;
    expect(sudokuVariantPayloadSchema.safeParse(payload).success).toBe(true);
    expect(analyzeSudokuCoursewareActivity(payload)).toMatchObject({ready:false,code:"invalid-rules"});
  });
  it("keeps authored rules across mirrored edits and highlights the actual irregular cells", () => {
    const payload=createDefaultSudokuVariantPayload("parity-4x4");
    payload.rules={kind:"parity",cells:[2,...Array(15).fill(0)]};
    const spec=sudokuPayloadVariant(payload);
    let state=createSudokuBoardState(payload.puzzle,null,spec);
    state=chooseSudokuDigit(state,1); state=selectSudokuCell(state,payload.puzzle,0);
    expect(state.values[0]).toBe(0); expect(state.invalidAttempt?.digit).toBe(1);
    const mirror=toSudokuMirrorState(state);
    expect(mirror).not.toHaveProperty("variantRules");
    state=createSudokuBoardState(payload.puzzle,mirror,spec);
    expect(state.variantRules).toEqual(payload.rules);
    const irregular={...getSudokuVariant("irregular-4x4")!,rules:{kind:"irregular" as const,regions:[0,0,0,1,0,1,1,1,2,2,2,3,2,3,3,3]}};
    let jigsaw=createSudokuBoardState(Array(16).fill(0),null,irregular);
    jigsaw=setSudokuHighlightTool(jigsaw,"box"); jigsaw=selectSudokuCell(jigsaw,Array(16).fill(0),4);
    expect(sudokuHighlightRegions(jigsaw.highlights,4,irregular).map(r=>[r.rowStart,r.columnStart])).toEqual([[1,1],[1,2],[1,3],[2,1]]);
  });
  it("embeds a native teaching target in a formal course without asserting a full solution", () => {
    const bank=JSON.parse(readFileSync("content/courses/sudoku-2026/bank.json","utf8"));
    const record=bank.puzzles.find((p:{id:string})=>p.id==="B3-ineq-explore");
    const payload=sudokuVariantPayloadSchema.parse({...createDefaultSudokuVariantPayload("inequality-4x4"),puzzle:record.puzzle,rules:record.rules,goal:{kind:"teaching-target",targets:record.targets.map((t:object)=>({kind:"cell-value",...t}))}});
    const checked=validateGameCoursewareContent("sudoku","sudoku-authored-v3",payload);
    expect(checked.validation).toMatchObject({publishable:true,code:"teaching-target-ready"});
    expect(countSudokuSolutions(payload.puzzle,2,sudokuPayloadVariant(payload))).toBe(2);
    const doc=createEmptyCoursewareCompositionPage();
    doc.layout.blocks.push({id:"test",type:"game",placement:{column:0,row:0,columnSpan:12,rowSpan:9},game:{docVersion:"game-page-v1",canvas:doc.canvas,gameId:"sudoku",contentVersion:"sudoku-authored-v3",...checked}});
    expect(formalManualPageSchema.safeParse(doc).success).toBe(true);
  });
});
