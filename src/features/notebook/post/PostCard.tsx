import { Heart } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { PublicPost } from "./types";

export async function PostCard({ post, locale }: { post: PublicPost; locale: string }) {
  const t = await getTranslations("notebook.public");
  const displayName = post.author.displayName || t("anonymous");
  const initial = displayName.trim().slice(0, 1).toUpperCase();
  return (
    <article className="rounded-2xl border bg-card p-5 transition-[color,background-color,border-color,transform] duration-200 hover:-translate-y-0.5">
      <div className="flex items-center gap-3 text-sm text-muted">
        <span className="grid size-8 place-items-center rounded-full border bg-paper text-xs font-medium text-ink" aria-hidden>{initial}</span>
        <span className="font-medium text-ink">{displayName}</span>
        <time className="ml-auto" dateTime={post.publishedAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(post.publishedAt))}</time>
      </div>
      <Link href={`/notebook/${post.id}`} className="mt-4 block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-crater">
        <h2 className="font-display text-2xl">{post.title || t("untitled")}</h2>
        <p className="mt-2 line-clamp-2 min-h-12 leading-6 text-muted">{post.excerpt || t("noExcerpt")}</p>
      </Link>
      <div className="mt-4 flex items-center gap-1 text-sm text-muted"><Heart size={15} fill={post.likeCount > 0 ? "var(--cheek)" : "none"} />{post.likeCount}</div>
    </article>
  );
}
