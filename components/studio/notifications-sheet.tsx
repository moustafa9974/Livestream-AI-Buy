"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface Item {
  id: string;
  type: string;
  title: string;
  body: string;
  zapierStatus: string | null;
  read: boolean;
  at: string;
}

export function NotificationsSheet({ open, onOpenChange, onRead }: { open: boolean; onOpenChange: (o: boolean) => void; onRead: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    fetch("/api/studio/notifications")
      .then((r) => r.json())
      .then((d: { items: Item[] }) => {
        if (stop) return;
        setItems(d.items);
        if (d.items.some((i) => !i.read)) void fetch("/api/studio/notifications", { method: "POST" }).then(onRead);
      })
      .catch(() => !stop && setItems([]));
    return () => {
      stop = true;
    };
  }, [open, onRead]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription>Sales, payouts and recaps. Also sent to your Zap when connected in Settings.</SheetDescription>
        </SheetHeader>
        <ul className="flex flex-col gap-2 overflow-y-auto px-4 pb-6">
          {items === null && <li className="text-sm text-muted-foreground">Loading…</li>}
          {items?.length === 0 && <li className="text-sm text-muted-foreground">Nothing yet. Sales and payouts show up here.</li>}
          {items?.map((n) => (
            <li key={n.id} className={`rounded-xl border p-3 ${n.read ? "bg-card" : "border-primary/40 bg-accent/50"}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{n.title}</p>
                {n.zapierStatus === "delivered" && <Badge variant="secondary">sent to Zapier</Badge>}
                {n.zapierStatus === "failed" && <Badge variant="destructive">Zapier failed</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{n.body}</p>
              <time className="text-xs text-muted-foreground" dateTime={n.at}>
                {new Date(n.at).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
