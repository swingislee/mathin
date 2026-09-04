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
    active: "border-yellow-400 bg-yellow-300 text-yellow-950 shadow-sm dark:border-yellow-500 dark:bg-yellow-500",
    card: "border-yellow-400/50 bg-yellow-400/[0.05] dark:bg-yellow-950/15",
    dot: "bg-yellow-400",
    icon: "text-yellow-700 dark:text-yellow-300",
    idle: "hover:border-yellow-400/50 hover:bg-yellow-400/10 hover:text-yellow-800 dark:hover:text-yellow-200",
  },
  imitated: {
    active: "border-orange-500 bg-orange-500 text-white shadow-sm",
    card: "border-orange-500/45 bg-orange-500/[0.04] dark:bg-orange-950/15",
    dot: "bg-orange-500",
    icon: "text-orange-600 dark:text-orange-300",
    idle: "hover:border-orange-500/45 hover:bg-orange-500/10 hover:text-orange-700 dark:hover:text-orange-200",
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
