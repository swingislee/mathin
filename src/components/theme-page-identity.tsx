import { cn } from "@/lib/utils";

const tones = {
  story: {
    eyebrow: "text-[#816948]",
    description: "text-[#6c5a43]",
  },
  games: {
    eyebrow: "text-[#895d4e]",
    description: "text-[#69574b]",
  },
  minds: {
    eyebrow: "text-[#6d6376]",
    description: "text-[#6f6670]",
  },
  terms: {
    eyebrow: "text-[#aeb5cc]",
    description: "text-[#c8cbda]",
  },
  tools: {
    eyebrow: "text-[#74583b]",
    description: "text-[#6d5940]",
  },
} as const;

export function ThemePageIdentity({ sectionName, planetName, description, tone, className }: {
  sectionName: string;
  planetName: string;
  description: string;
  tone: keyof typeof tones;
  className?: string;
}) {
  const palette = tones[tone];
  return (
    <header className={cn("scene-enter scene-title-shadow absolute left-6 top-20 z-10 max-w-md md:left-8 md:top-24", className)}>
      <p className={cn("text-xs uppercase tracking-[0.22em]", palette.eyebrow)}>{planetName}</p>
      <h1 className="mt-2 font-display text-4xl leading-tight md:text-5xl">{sectionName}</h1>
      <p className={cn("mt-3 max-w-sm text-sm leading-6 md:text-base", palette.description)}>{description}</p>
    </header>
  );
}
