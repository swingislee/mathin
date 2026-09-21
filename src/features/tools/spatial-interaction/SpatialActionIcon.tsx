import type { ComponentType, SVGProps } from "react";
import { Camera, FolderOpen, GitCompare, LayoutDashboard, MoveVertical, RefreshCw, Save } from "lucide-react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BadgeCheck, Beaker, Box, Boxes, Check, ChevronDown, ChevronLeft, Circle, CircleDot, Dice5, Dices, Eraser, Eye, EyeOff, Focus, FoldHorizontal, Footprints, Gauge, GitCompareArrows, GlassWater, Grid2X2, Group, Hand, Hash, Layers3, LayoutTemplate, LocateFixed, Magnet, Maximize, Minus, MousePointer2, Move3D, Orbit, PaintBucket, Paintbrush, PanelsTopLeft, Pause, Pencil, PencilRuler, Play, Plus, Presentation, Redo2, Rotate3D, RotateCcw, RotateCw, Ruler, ScanEye, ScanFace, Scissors, Settings2, Shapes, SkipBack, SkipForward, Spline, Square, SquareDashed, SquareDashedMousePointer, Stamp, Tags, Trash2, Undo2, UnfoldHorizontal, Ungroup, X } from "lucide-react";
import { SPATIAL_ACTIONS, type SpatialActionId, type SpatialIconId } from "./actions";
import { CUBE_AXIS_COLORS } from "../spatial-lab/cube-structures-contract";

type IconProps = SVGProps<SVGSVGElement>;
function Svg(props: IconProps) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props} />; }
function FaceReveal(props: IconProps) { return <Svg {...props}><path d="m3 8 6-3 6 3v9l-6 3-6-3Zm0 0 6 3 6-3M9 11v9" opacity=".6" /><path d="m18 10 4-2v9l-4 2Z" /><path d="M12 13h5m-2-2 2 2-2 2" /></Svg>; }
function Opacity(props: IconProps) { return <Svg {...props}><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 0 0 16Z" fill="currentColor" opacity=".5" /><path d="M12 4v16" strokeDasharray="2 2" /></Svg>; }
function Axes(props: IconProps) { return <Svg {...props}><path d="M5 19h15" stroke={CUBE_AXIS_COLORS.x} /><path d="M5 19V3" stroke={CUBE_AXIS_COLORS.y} /><path d="m5 19 11-10" stroke={CUBE_AXIS_COLORS.z} /></Svg>; }
function MoveSnap(props: IconProps) { return <Svg {...props}><path d="M4 3h6v6H4ZM14 15h6v6h-6Z" /><path d="M7 10v8h6m-3-3 3 3-3 3" strokeDasharray="2 2" /></Svg>; }
function Separate(props: IconProps) { return <Svg {...props}><rect x="2" y="9" width="5" height="8" rx="1" /><rect x="17" y="9" width="5" height="8" rx="1" /><path d="M8 5H3m2-2L3 5l2 2m11-2h5m-2-2 2 2-2 2" /></Svg>; }
function Section(props: IconProps) { return <Svg {...props}><path d="m7 3 11 4v13L7 16Zm0 0L3 6v13l4-3m11-9 3-3v13l-3 3" opacity=".55" /><path d="m2 11 5-3 15 5-5 3Z" fill="currentColor" fillOpacity=".18" /></Svg>; }
function Dimensions(props: IconProps) { return <Svg {...props}><rect x="7" y="4" width="13" height="12" rx="1" /><path d="M3 4v12m-1-12h2m-2 12h2m3 5h13m-13-1v2m13-2v2" /></Svg>; }
function FoldSolid(props: IconProps) { return <Svg {...props}><path d="m12 8 7 4v8l-7 3-7-3v-8Zm-7 4 7 4 7-4m-7 4v7" /><path d="M4 8a8 8 0 0 1 14-3m-4 0h4V1" /></Svg>; }
function NetGallery(props: IconProps) { return <Svg {...props}><path d="M2 9h20v5H2Zm5-5h5v15H7ZM12 9v5m5-5v5" /></Svg>; }
function Contact(props: IconProps) { return <Svg {...props}><path d="M3 7h8v12H3ZM13 7h8v12h-8Z" /><path d="M11 4h2m-2 18h2" /><circle cx="6" cy="11" r=".7" fill="currentColor" /><circle cx="17" cy="15" r=".7" fill="currentColor" /></Svg>; }
function Sweep(props: IconProps) { return <Svg {...props}><path d="M12 3v18M12 5h7v12h-7" /><ellipse cx="12" cy="17" rx="9" ry="4" strokeDasharray="2 2" /><path d="M3 10c0-2 4-4 9-4m-3-2 3 2-3 2" /></Svg>; }

/** 每种语义只有这一份 SVG；参数方向可以共用基础箭头，舞台动作不能自行选图。 */
const allIcons = { Sweep, GitCompare, LayoutDashboard, Camera, FolderOpen, MoveVertical, RefreshCw, Save, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BadgeCheck, Beaker, Box, Boxes, Check, ChevronDown, ChevronLeft, Circle, CircleDot, Dice5, Dices, Eraser, Eye, EyeOff, Focus, FoldHorizontal, Footprints, Gauge, GitCompareArrows, GlassWater, Grid2X2, Group, Hand, Hash, Layers3, LayoutTemplate, LocateFixed, Magnet, Maximize, Minus, MousePointer2, Move3D, Orbit, PaintBucket, Paintbrush, PanelsTopLeft, Pause, Pencil, PencilRuler, Play, Plus, Presentation, Redo2, Rotate3D, RotateCcw, RotateCw, Ruler, ScanEye, ScanFace, Scissors, Settings2, Shapes, SkipBack, SkipForward, Spline, Square, SquareDashed, SquareDashedMousePointer, Stamp, Tags, Trash2, Undo2, UnfoldHorizontal, Ungroup, X, FaceReveal, Opacity, Axes, MoveSnap, Separate, Section, Dimensions, FoldSolid, NetGallery, Contact } satisfies Record<SpatialIconId, ComponentType<IconProps>>;

export function SpatialActionIcon({ action, ...props }: IconProps & { action: SpatialActionId }) {
  const Icon = allIcons[SPATIAL_ACTIONS[action].icon];
  return <Icon {...props} aria-hidden="true" focusable="false" data-spatial-icon={action} />;
}
