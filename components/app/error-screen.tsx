"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

const AUTO_RETRIES = 2;
const AUTO_RETRY_MS = 3000;

/**
 * Shown by app/error.tsx and app/studio/error.tsx when a page fails to render, most often
 * because the free database is waking up or the network blipped. It retries on its own a
 * couple of times before asking, so a brief hiccup fixes itself without a click.
 * (Next 16's error boundary passes `retry`, not the older `reset`.)
 */
export function ErrorScreen({ error, retry }: { error: unknown; retry: () => void }) {
  const tries = useRef(0);
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    console.error(error);
    if (tries.current >= AUTO_RETRIES) {
      setWaiting(false);
      return;
    }
    const t = setTimeout(() => {
      tries.current += 1;
      retry();
    }, AUTO_RETRY_MS);
    return () => clearTimeout(t);
  }, [error, retry]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <span className="glass grid size-14 place-items-center rounded-2xl text-primary" aria-hidden>
        {waiting ? <RefreshCw className="size-6 motion-safe:animate-spin" /> : <WifiOff className="size-6" />}
      </span>
      <h1 className="text-2xl font-semibold">{waiting ? "Reconnecting…" : "We couldn't load this page"}</h1>
      <p className="text-sm text-muted-foreground" role="status">
        {waiting
          ? "The connection hiccupped for a moment. Trying again on its own."
          : "Check your connection, then try again. Your data is safe: nothing was lost."}
      </p>
      {!waiting && (
        <Button
          className="glow-cta border-0 text-white hover:brightness-110"
          onClick={() => {
            tries.current = 0;
            setWaiting(true);
            retry();
          }}
        >
          <RefreshCw aria-hidden /> Try again
        </Button>
      )}
    </main>
  );
}
