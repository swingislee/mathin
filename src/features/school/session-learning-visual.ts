import type { LearningCheckStatus } from "./session-learning-contract";

export interface LearningCheckStatusStyle {
  active: string;
  card: string;
  dot: string;
  icon: string;
  idle: string;
}

/** Shared status language for the full learning panel and its compact classroom summary. */
export const LEARNING_CHECK_STATUS_STYLE: Record<LearningCheckStatus, LearningCheckStatusStyle> = {
  explained: {
    active: "border-sky-500 bg-sky-500 text-white shadow-sm",
    card: "border-sky-500/45 bg-sky-500/[0.04] dark:bg-sky-950/15",
    dot: "bg-sky-500",
    icon: "text-sky-600 dark:text-sky-300",
    idle: "hover:border-sky-500/45 hover:bg-sky-500/10 hover:text-sky-700 dark:hover:text-sky-200",
  },
  independent: {
    active: "border-leaf bg-leaf text-white shadow-sm",
    card: "border-leaf/50 bg-leaf/[0.05]",
    dot: "bg-leaf",
    icon: "text-leaf-deep dark:text-leaf",
    idle: "hover:border-leaf/50 hover:bg-leaf/10 hover:text-leaf-deep",
  },
  prompted: {
    active: "border-amber-400 bg-amber-300 text-amber-950 shadow-sm dark:border-amber-500 dark:bg-amber-500",
    card: "border-amber-400/50 bg-amber-400/[0.05] dark:bg-amber-950/15",
    dot: "bg-amber-400",
    icon: "text-amber-700 dark:text-amber-300",
    idle: "hover:border-amber-400/50 hover:bg-amber-400/10 hover:text-amber-800 dark:hover:text-amber-200",
  },
  imitated: {
    active: "border-violet-500 bg-violet-500 text-white shadow-sm",
    card: "border-violet-500/45 bg-violet-500/[0.04] dark:bg-violet-950/15",
    dot: "bg-violet-500",
    icon: "text-violet-600 dark:text-violet-300",
    idle: "hover:border-violet-500/45 hover:bg-violet-500/10 hover:text-violet-700 dark:hover:text-violet-200",
  },
  incomplete: {
    active: "border-rose bg-rose text-white shadow-sm",
    card: "border-rose/45 bg-rose/[0.04]",
    dot: "bg-rose",
    icon: "text-rose",
    idle: "hover:border-rose/45 hover:bg-rose/10 hover:text-rose",
  },
  unchecked: {
    active: "border-crater/70 bg-line/70 text-muted",
    card: "border-dashed border-line bg-card/70",
    dot: "bg-crater",
    icon: "text-crater",
    idle: "hover:border-crater/60 hover:bg-line/50 hover:text-ink",
  },
};
