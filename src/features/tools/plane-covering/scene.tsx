import type { PlanarState } from "../planar-kit/contract";
import { textFor, type PlanarDrawingApi, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { addCoverPiece, clearCoverPieces, coverBounds, coverCounts, coverIds, coverInTray, coverOrigin, coverPiece, coverPieces, coverTarget, coverToStage, COVER_CELL, createCoverState, dragCover, duplicateCover, missingCellKey, parkCover, removeCover, setCoverField, settleCover, tapCover, trayMaxRow, turnCover } from "./model";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const caption = { fill: "var(--ink)", stroke: "var(--paper)", strokeWidth: 5, paintOrder: "stroke" as const, fontSize: 16 };
const hasSelected = (state: PlanarState, target: string | null) => { const id = coverTarget(target); return id !== null && !!coverPiece(state, id); };
function CoverDrawing({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const origin = coverOrigin(state), pieces = coverPieces(state), selected = coverTarget(api.selected), counts = coverCounts(state);
  const exact = pieces.every((piece) => [0, 90].includes(piece.angle) && piece.at.x === state.points[`home.${piece.id}`].x && piece.at.y === state.points[`home.${piece.id}`].y);
  return <g data-covering="open-board">
    {Array.from({ length: state.params.columns * state.params.rows }, (_, index) => {
      const x = index % state.params.columns, y = Math.floor(index / state.params.columns), missing = state.marks.includes(missingCellKey({ x, y }));
      return <g key={index} {...(state.flags.editCells ? api.bind(`cell.${x}_${y}`, `${textFor(t("移去或还原格子", "Remove or restore cell"), api.locale)} (${x + 1}, ${y + 1})`) : {})}>
        <rect x={origin.x + x * COVER_CELL} y={origin.y + y * COVER_CELL} width={COVER_CELL} height={COVER_CELL} fill={missing ? "none" : state.flags.coloring && (x + y) % 2 === 0 ? "var(--crater)" : "var(--paper)"} stroke="var(--line)" strokeDasharray={missing ? "3 5" : undefined} />
        {state.flags.editCells && <rect x={origin.x + x * COVER_CELL} y={origin.y + y * COVER_CELL} width={COVER_CELL} height={COVER_CELL} fill="transparent" style={{ cursor: "pointer" }} />}
        {missing && <text x={origin.x + (x + 0.5) * COVER_CELL} y={origin.y + (y + 0.64) * COVER_CELL} textAnchor="middle" fill="var(--muted)" pointerEvents="none">×</text>}
      </g>;
    })}
    <g data-cover-tray="true" pointerEvents="none">
      <rect x={origin.x + (state.params.columns + 1) * COVER_CELL} y={origin.y} width={5 * COVER_CELL} height={(trayMaxRow(state) + 2) * COVER_CELL} rx={12} fill="none" stroke="var(--line)" strokeDasharray="5 5" />
      <text x={origin.x + (state.params.columns + 1) * COVER_CELL} y={origin.y - 14} style={caption}>{textFor(t("待用骨牌", "Domino supply"), api.locale)}</text>
    </g>
    {[...pieces.filter((piece) => piece.id !== selected), ...pieces.filter((piece) => piece.id === selected)].map((piece) => {
      const at = coverToStage(state, piece.at);
      return <g key={piece.id} {...api.bind(`piece.${piece.id}`, `${textFor(t("骨牌", "Domino"), api.locale)} ${piece.id + 1}`)} transform={`translate(${at.x} ${at.y}) rotate(${piece.angle})`} style={{ cursor: "grab" }}>
        <rect x={-COVER_CELL / 2 + 3} y={-COVER_CELL / 2 + 3} width={COVER_CELL * 2 - 6} height={COVER_CELL - 6} rx={7} fill="var(--leaf)" fillOpacity={0.8} stroke={selected === piece.id ? "var(--rose)" : "var(--leaf-deep)"} strokeWidth={selected === piece.id ? 3 : 1.5} />
        <line x1={COVER_CELL / 2} y1={-COVER_CELL / 2 + 6} x2={COVER_CELL / 2} y2={COVER_CELL / 2 - 6} stroke="var(--leaf-deep)" strokeDasharray="3 3" />
        {state.flags.labels && <text x={0} y={5} textAnchor="middle" style={caption} transform={`rotate(${-piece.angle})`} pointerEvents="none">{piece.id + 1}</text>}
      </g>;
    })}
    {state.flags.measures && exact && <g pointerEvents="none">
      <text x={40} y={650} style={caption}>{textFor(t("棋盘剩余", "Remaining board"), api.locale)}：{textFor(t("深色", "dark"), api.locale)} {counts.dark} · {textFor(t("浅色", "light"), api.locale)} {counts.light}　{ textFor(t("缺格", "removed"), api.locale)} {counts.missing}</text>
      <text x={40} y={679} style={caption}>{textFor(t("未覆盖", "Uncovered"), api.locale)}：{textFor(t("深色", "dark"), api.locale)} {counts.dark - counts.coveredDark} · {textFor(t("浅色", "light"), api.locale)} {counts.light - counts.coveredLight}　{ textFor(t("已铺／待用", "Placed / supply"), api.locale)} {counts.placed} / {counts.waiting}</text>
    </g>}
    {state.flags.editCells && !state.flags.measures && <text x={40} y={672} style={caption} pointerEvents="none">{textFor(t("点击空格挖空或还原；被占格先移开骨牌", "Tap an empty cell to remove or restore it; move dominoes first"), api.locale)}</text>}
  </g>;
}

export const planeCoveringScene: PlanarSceneDefinition = {
  id: "57-create", toolId: "plane-covering", title: t("棋盘染色与覆盖", "Board colouring and covering"), referenceGrid: false,
  description: t("调整棋盘行列、挖空或还原格子，再独立摆放骨牌。每块覆盖两个相邻格；松手吸附到合法位置，缩小棋盘时超出的骨牌留在待用区。颜色数量按需显示，不自动判断能否铺满。", "Resize the board, remove or restore cells, then arrange individual dominoes. Each covers two neighbouring cells. Release to snap to a legal position; pieces outside a resized board move to the supply area. Show colour counts when needed, without a solvability verdict."),
  create: createCoverState,
  materials: ([0, 90] as const).map((angle) => ({ id: `domino-${angle}`, label: angle === 0 ? t("横向骨牌", "Horizontal domino") : t("竖向骨牌", "Vertical domino"), group: t("添加两格骨牌", "Add a two-cell domino"),
    preview: <svg viewBox="0 0 100 76" width="76" height="60" aria-hidden="true"><g transform={`translate(50 38) rotate(${angle})`}><rect x={-32} y={-16} width={64} height={32} rx={6} fill="var(--leaf)" stroke="var(--leaf-deep)" /><path d="M0 -12V12" stroke="var(--leaf-deep)" strokeDasharray="3 3" /></g></svg>,
    add: (state) => addCoverPiece(state, angle), disabled: (state) => addCoverPiece(state, angle) === state,
  })),
  toggles: [{ key: "coloring", label: t("棋盘双色染色", "Two-colour checkerboard") }, { key: "labels", label: t("显示骨牌编号", "Show domino numbers") }],
  actions: [
    { id: "cover-edit", icon: "editShape", label: t("挖空或还原格子", "Remove or restore cells"), active: (state) => state.flags.editCells, run: (state) => ({ ...state, flags: { ...state.flags, editCells: !state.flags.editCells } }) },
    { id: "cover-turn", icon: "rotate", label: t("转动所选骨牌", "Turn selected domino"), duration: 450, run: (state, context) => turnCover(state, context.selected), disabled: (state, context) => turnCover(state, context.selected) === state },
    { id: "cover-duplicate", icon: "duplicate", label: t("复制所选骨牌", "Duplicate selected domino"), run: (state, context) => duplicateCover(state, context.selected), disabled: (state, context) => duplicateCover(state, context.selected) === state },
    { id: "cover-remove", icon: "remove", label: t("移除所选骨牌", "Remove selected domino"), run: (state, context) => removeCover(state, context.selected), disabled: (state, context) => !hasSelected(state, context.selected) },
  ],
  operations: [
    { id: "board", icon: "dimensions", label: t("棋盘尺寸与材料", "Board size and materials"), fields: [
      { key: "columns", label: t("棋盘列数", "Board columns"), min: 1, max: 12, step: 1 }, { key: "rows", label: t("棋盘行数", "Board rows"), min: 1, max: 12, step: 1 },
    ], actions: [
      { id: "cover-restore-cells", icon: "clear", label: t("还原全部缺格", "Restore all removed cells"), run: (state) => ({ ...state, marks: [] }), disabled: (state) => state.marks.length === 0 },
      { id: "cover-clear", icon: "remove", label: t("收起全部骨牌，保留棋盘", "Remove all dominoes, keep the board"), run: clearCoverPieces, disabled: (state) => !coverIds(state).length },
    ] },
    { id: "move", icon: "move", label: t("骨牌落点与待用区", "Domino position and supply"), fields: [
      { key: "column", label: t("起始列（从 0 计）", "Start column (zero-based)"), min: 0, max: 16, step: 1, read: (state) => coverPiece(state)?.at.x ?? 0, disabled: (state) => !coverPiece(state) },
      { key: "row", label: t("起始行（从 0 计）", "Start row (zero-based)"), min: 0, max: 11, step: 1, read: (state) => coverPiece(state)?.at.y ?? 0, disabled: (state) => !coverPiece(state) },
    ], actions: [{ id: "cover-park", icon: "separate", label: t("移到待用区", "Move to the supply area"), run: (state, context) => parkCover(state, context.selected), disabled: (state, context) => { const id = coverTarget(context.selected), piece = id === null ? null : coverPiece(state, id); return !piece || coverInTray(state, piece); } }] },
  ],
  setField: setCoverField, tap: tapCover,
  drag: (state, target, _at, delta) => dragCover(state, target, delta), snap: settleCover,
  selectionAfterChange: (before, after, selected) => before.params.active !== after.params.active || before.params.nextId !== after.params.nextId ? after.params.active < 0 ? null : `piece.${after.params.active}` : selected && hasSelected(after, selected) ? selected : null,
  contextActions: (state, selected) => { const id = coverTarget(selected), piece = id === null ? null : coverPiece(state, id); return piece ? { bounds: coverBounds(state, piece), items: [{ kind: "operation", id: "move" }, { kind: "action", id: "cover-turn" }, { kind: "action", id: "cover-duplicate" }, { kind: "action", id: "cover-park" }, { kind: "action", id: "cover-remove" }] } : null; },
  draw: (state, api) => <CoverDrawing state={state} api={api} />,
  summary: (state, locale) => `${state.params.columns} × ${state.params.rows} · ${coverIds(state).length} ${locale === "en" ? "dominoes" : "块骨牌"}`,
};
