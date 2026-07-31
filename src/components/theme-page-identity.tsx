import { cn } from "@/lib/utils";

export function ThemePageIdentity({ sectionName, planetName, description, tone, className }: {
  sectionName: string;
  planetName: string;
  description: string;
  tone: "story" | "games" | "minds" | "terms" | "tools";
  className?: string;
}) {
  return (
    <header data-scene-tone={tone} className={cn("scene-enter scene-title-shadow absolute left-6 top-20 z-10 max-w-md md:left-8 md:top-24", className)}>
      <p className="theme-page-eyebrow text-xs uppercase tracking-[0.22em]">{planetName}</p>
      <h1 className="theme-page-title mt-2 font-display text-4xl leading-tight md:text-5xl">{sectionName}</h1>
      <p className="theme-page-description mt-3 max-w-sm text-sm leading-6 md:text-base">{description}</p>
    </header>
  );
}
