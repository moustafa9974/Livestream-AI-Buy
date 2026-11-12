"use client"; // Error boundaries must be Client Components

import { ErrorScreen } from "@/components/app/error-screen";

/** A page that fails to render (e.g. the free database waking up) gets a calm retry screen. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
