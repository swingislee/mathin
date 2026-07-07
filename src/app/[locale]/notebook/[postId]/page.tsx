import { notFound } from "next/navigation";

export default async function NotebookPostPlaceholder({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  if (!postId) notFound();
  notFound();
}
