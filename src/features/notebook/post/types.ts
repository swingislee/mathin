export interface PublicPost {
  id: string;
  title: string;
  excerpt: string;
  contentHtml?: string;
  likeCount: number;
  publishedAt: string;
  updatedAt: string;
  author: {
    id?: string;
    displayName: string;
    avatarUrl: string | null;
  };
}
