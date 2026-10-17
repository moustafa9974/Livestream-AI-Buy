"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ZapierSettings({ initialUrl, enabled }: { initialUrl: string; enabled: boolean }) {
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);

  async function save(sendTest = false) {
    setBusy(true);
    try {
      const res = await fetch("/api/studio/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zapierWebhookUrl: url.trim(), sendTest }),
      });
      const data = (await res.json()) as { error?: string; fields?: string[]; zapierStatus?: string | null };
      if (!res.ok) throw new Error(data.error === "Invalid request" ? "That isn't a Zapier Catch Hook URL" : (data.error ?? "Save failed"));
      if (sendTest) {
        if (data.zapierStatus === "delivered") toast.success("Test event delivered to Zapier");
        else if (data.zapierStatus === "failed") toast.error("Zapier didn't accept the test event. Check the URL and that the Zap is on.");
        else toast("Saved. Test went to the notification center only (Zapier is off or no URL).");
      } else {
        toast.success("Saved");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://hooks.zapier.com/hooks/catch/123456/abcdef/"
        aria-label="Zapier Catch Hook URL"
        className="min-w-72 flex-1"
      />
      <Button type="submit" disabled={busy}>Save</Button>
      <Button type="button" variant="outline" disabled={busy || !url || !enabled} onClick={() => save(true)}>
        Send test event
      </Button>
    </form>
  );
}
