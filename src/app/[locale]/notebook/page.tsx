import { getTranslations, setRequestLocale } from "next-intl/server";
import { SectionShell } from "@/components/section-shell";
import { PostCard } from "@/features/notebook/post/PostCard";
import type { PublicPost } from "@/features/notebook/post/types";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

interface PostRow {
  id: string; title: string; excerpt: string; like_count: number; published_at: string; updated_at: string;
  author: { display_name: string; avatar_url: string | null } | Array<{ display_name: string; avatar_url: string | null }>;
}

export default async function NotebookPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ sort?: string; page?: string }> }) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("notebook.public");
  const sort = query.sort === "hot" ? "hot" : "latest";
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const supabase = await createClient();
  let request = supabase
    .from("posts")
    .select("id,title,excerpt,like_count,published_at,updated_at,author:profiles!posts_author_id_fkey(display_name,avatar_url)", { count: "exact" });
  request = sort === "hot"
    ? request.order("like_count", { ascending: false }).order("published_at", { ascending: false })
    : request.order("published_at", { ascending: false });
  const from = (page - 1) * 20;
  const { data, count, error } = await request.range(from, from + 19).returns<PostRow[]>();
  if (error) throw new Error(error.message);
  const posts: PublicPost[] = (data ?? []).map((row) => {
    const author = Array.isArray(row.author) ? row.author[0] : row.author;
    return { id: row.id, title: row.title, excerpt: row.excerpt, likeCount: row.like_count, publishedAt: row.published_at, updatedAt: row.updated_at, author: { displayName: author?.display_name ?? "", avatarUrl: author?.avatar_url ?? null } };
  });
  const hasNext = from + posts.length < (count ?? 0);
  return (
    <SectionShell section="notebook" intro={t("intro")} wide>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Link href="/notebook?sort=latest" className={`rounded-full border px-4 py-2 text-sm ${sort === "latest" ? "border-cheek bg-cheek/35" : "border-crater"}`}>{t("latest")}</Link>
        <Link href="/notebook?sort=hot" className={`rounded-full border px-4 py-2 text-sm ${sort === "hot" ? "border-cheek bg-cheek/35" : "border-crater"}`}>{t("hot")}</Link>
        <Link href="/notebook/me" className="ml-auto rounded-full border border-crater px-4 py-2 text-sm">{t("myWorkspace")}</Link>
      </div>
      {posts.length ? <div className="grid gap-4 md:grid-cols-2">{posts.map((post) => <PostCard key={post.id} post={post} locale={locale} />)}</div> : <p className="rounded-2xl border border-dashed p-10 text-center text-muted">{t("empty")}</p>}
      {(page > 1 || hasNext) && <nav className="mt-8 flex justify-center gap-3">{page > 1 && <Link href={`/notebook?sort=${sort}&page=${page - 1}`} className="rounded-full border border-crater px-4 py-2 text-sm">{t("previous")}</Link>}{hasNext && <Link href={`/notebook?sort=${sort}&page=${page + 1}`} className="rounded-full border border-crater px-4 py-2 text-sm">{t("next")}</Link>}</nav>}
    </SectionShell>
  );
}
