"use client";

import { Heart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Link } from "@/i18n/navigation";
import { toggleLike } from "../actions";

export function LikeButton({ postId, initialLiked, initialCount, isLoggedIn, loginHref }: {
  postId: string;
  initialLiked: boolean;
  initialCount: number;
  isLoggedIn: boolean;
  loginHref: string;
}) {
  const t = useTranslations("notebook.public");
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [pending, startTransition] = useTransition();
  if (!isLoggedIn) {
    return <Link href={loginHref} className="inline-flex items-center gap-2 rounded-full border border-crater px-4 py-2 text-sm"><Heart size={17} />{t("loginToLike")} · {count}</Link>;
  }
  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={liked}
      onClick={() => {
        const previous = { liked, count };
        setLiked(!liked);
        setCount((value) => value + (liked ? -1 : 1));
        startTransition(async () => {
          try {
            const result = await toggleLike(postId);
            setLiked(result.liked);
            setCount(result.likeCount);
          } catch {
            setLiked(previous.liked);
            setCount(previous.count);
          }
        });
      }}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors duration-200 ${liked ? "border-cheek bg-cheek/35" : "border-crater hover:bg-cheek/20"}`}
    >
      <Heart size={17} fill={liked ? "var(--cheek)" : "none"} />{liked ? t("liked") : t("like")} · {count}
    </button>
  );
}
