"use client";

import { RouteErrorState } from "@/components/RouteErrorState";

export default function SessionError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState {...props} />;
}
