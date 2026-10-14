"use client";

import { RouteErrorState } from "@/components/RouteErrorState";

export default function ErrorBoundary(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState {...props} fullPage />;
}
