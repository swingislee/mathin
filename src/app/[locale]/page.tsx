import Image from "next/image";
import { ArrowRight, BookOpen, Lightbulb, Puzzle, Sprout, Wrench } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { PlanetLink, type PlanetAccent } from "@/components/planet-link";
import { SiteHeader } from "@/components/site-header";
import { Star4 } from "@/components/star4";
import { StarPath } from "@/components/star-path";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * 主图定位采用 focus box 适配（见 globals.css 的 .hero-stage/.hero-art）：
 * 锚定的是主视觉构图区域（王子+玫瑰+月亮+入口轨道，center 54%/57%、尺寸 64%×70%），
 * 由 CSS 容器查询单位按舞台短边自动缩放并居中，无手动偏移经验值。
 * 轨道与站点定位在 .hero-art 图片坐标系内：以月亮圆心 (50.6%, 62%) 为圆心、
 * 半径 33%（约月亮半径 1.3 倍）的同心圆弧，站点取圆上 θ = 35°/63°/91°/119°/147°。
 */
const stations: { slug: string; icon: typeof BookOpen; accent: PlanetAccent; left: string; top: string }[] = [
  { slug: "story", icon: BookOpen, accent: "rose", left: "69.5%", top: "35.0%" },
  { slug: "games", icon: Puzzle, accent: "moon", left: "80.0%", top: "47.0%" },
  { slug: "minds", icon: Lightbulb, accent: "crater", left: "83.6%", top: "62.6%" },
  { slug: "terms", icon: Sprout, accent: "leaf", left: "79.5%", top: "78.0%" },
  { slug: "tools", icon: Wrench, accent: "star", left: "68.6%", top: "89.7%" },
];

export default async function HomePage() {
  const home = await getTranslations("home");
  const nav = await getTranslations("nav");

  return (
    <main className="flex min-h-screen flex-col overflow-x-clip">
      <SiteHeader />

      {/* 桌面：左题签 + 右「星球地图」（单屏完成，无第二屏） */}
      <section className="mx-auto hidden w-full max-w-6xl flex-1 grid-cols-[5fr_7fr] gap-6 px-6 lg:grid">
        <div className="relative self-center pb-16">
          <StarPath d="M50 3 A47 47 0 1 1 49.9 3" viewBox="0 0 100 100" strokeWidth={1.25} className="absolute -left-14 -top-12 h-16 w-16 opacity-40" />
          <figure>
            <Star4 size={13} className="mb-6 opacity-80" />
            <blockquote lang="fr" className="max-w-[24ch] font-serif text-xl italic leading-relaxed text-ink/85 md:text-2xl">
              {home("quote")}
            </blockquote>
            <figcaption className="mt-5 text-sm leading-6 tracking-[0.35em] text-muted">{home("quoteTranslation")}</figcaption>
            <p className="mt-7 text-xs tracking-widest text-muted/70">— Le Petit Prince</p>
          </figure>
          <Link href="/terms" className={cn(buttonVariants(), "mt-10")}>
            {home("cta")}
            <ArrowRight size={16} />
          </Link>
          <Star4 size={9} className="absolute -bottom-6 left-24 opacity-60" />
        </div>

        <div className="relative h-full overflow-hidden">
          <div className="hero-stage absolute inset-0">
            <div className="hero-art">
              <Image
                src="/Main.png"
                alt={home("heroAlt")}
                width={1521}
                height={1521}
                priority
                className="pointer-events-none h-full w-full dark:brightness-95"
              />
              {/* 月亮的同心轨道弧（θ 25° → 157°） */}
              <StarPath viewBox="0 0 100 100" d="M64.6 32.1 A33 33 0 0 1 63.5 92.4" className="absolute inset-0 h-full w-full opacity-70" />
              {stations.map(({ slug, icon, accent, left, top }, i) => (
                <div
                  key={slug}
                  className="animate-float absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left, top, animationDelay: `${i * 1.2}s` } as CSSProperties}
                >
                  <PlanetLink href={`/${slug}`} label={nav(slug)} icon={icon} accent={accent} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 移动：一张完整的手机绘本扉页（题签压在星球插画之上，入口为小胶囊） */}
      <section className="relative flex flex-1 flex-col overflow-hidden px-6 pb-6 pt-4 lg:hidden">
        <div className="hero-stage pointer-events-none absolute inset-0" aria-hidden>
          <div className="hero-art opacity-95">
            <Image
              src="/Main.png"
              alt=""
              width={1521}
              height={1521}
              priority
              className="h-full w-full dark:brightness-95"
            />
          </div>
        </div>
        <div className="relative mx-auto mt-4 max-w-xs text-center">
          <Star4 size={11} className="mx-auto mb-4 opacity-80" />
          <blockquote lang="fr" className="font-serif text-lg italic leading-relaxed text-ink/85">{home("quote")}</blockquote>
          <p className="mt-3 text-xs leading-5 tracking-[0.3em] text-muted">{home("quoteTranslation")}</p>
        </div>
        <div className="flex-1" />
        <nav className="relative flex flex-wrap justify-center gap-2">
          {stations.map(({ slug, icon: Icon }) => (
            <Link key={slug} href={`/${slug}`} className="flex items-center gap-1.5 rounded-full border border-crater bg-card/85 px-3 py-1.5 text-xs transition duration-200 hover:bg-moon/50">
              <Icon size={13} strokeWidth={1.75} />
              <span>{nav(slug)}</span>
            </Link>
          ))}
        </nav>
        <Link href="/terms" className={cn(buttonVariants({ size: "sm" }), "relative mx-auto mt-4")}>
          {home("cta")}
          <ArrowRight size={14} />
        </Link>
      </section>
    </main>
  );
}
