import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { SectionShell } from "@/components/section-shell";
import { LikeButton } from "@/features/notebook/post/LikeButton";
import { ModerationPanel } from "@/features/notebook/post/ModerationPanel";
import { getProfile } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

interface DetailRow {
  id: string;
  title: string;
  excerpt: string;
  content_html: string;
  like_count: number;
  published_at: string;
  updated_at: string;
  review_status: string;
  author: { display_name: string; avatar_url: string | null } | Array<{ display_name: string; avatar_url: string | null }>;
}

async function loadPost(postId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select("id,title,excerpt,content_html,like_count,published_at,updated_at,review_status,author:profiles!posts_author_id_fkey(display_name,avatar_url)")
    .eq("id", postId)
    .maybeSingle<DetailRow>();
  if (error) throw new Error(error.message);
  return { supabase, post: data };
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; postId: string }> }): Promise<Metadata> {
  const { postId } = await params;
  const { post } = await loadPost(postId);
  if (!post) return {};
  return { title: post.title, description: post.excerpt };
}

export default async function NotebookPostPage({ params }: { params: Promise<{ locale: string; postId: string }> }) {
  const { locale, postId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("notebook.public");
  const { supabase, post } = await loadPost(postId);
  if (!post) notFound();
  const { data: { user } } = await supabase.auth.getUser();
  let liked = false;
  const profile = user ? await getProfile(user.id) : null;
  if (user) {
    const { data } = await supabase.from("post_likes").select("post_id").eq("post_id", post.id).eq("user_id", user.id).maybeSingle();
    liked = Boolean(data);
  }
  const author = Array.isArray(post.author) ? post.author[0] : post.author;
  const displayName = author?.display_name || t("anonymous");
  const nextPath = `/${locale}/notebook/${post.id}`;
  return (
    <SectionShell section="notebook">
      <article>
        <Link href="/notebook" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={15} />{t("backToFeed")}</Link>
        <h2 className="mt-7 font-display text-4xl leading-tight md:text-5xl">{post.title || t("untitled")}</h2>
        <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-muted">
          <span className="grid size-8 place-items-center rounded-full border bg-card text-xs text-ink" aria-hidden>{displayName.trim().slice(0, 1).toUpperCase()}</span>
          <span className="text-ink">{displayName}</span>
          <time dateTime={post.published_at}>{new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(post.published_at))}</time>
        </div>
        <div className="notebook-post-content mt-10" dangerouslySetInnerHTML={{ __html: post.content_html }} />
        {profile?.role === "admin" && <ModerationPanel postId={post.id} status={post.review_status} />}
        <div className="mt-10 border-t pt-6">
          <LikeButton postId={post.id} initialLiked={liked} initialCount={post.like_count} isLoggedIn={Boolean(user)} loginHref={`/login?next=${encodeURIComponent(nextPath)}`} />
        </div>
      </article>
    </SectionShell>
  );
}
