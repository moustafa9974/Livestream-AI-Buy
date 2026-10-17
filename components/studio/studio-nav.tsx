"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AssistantSheet } from "./assistant-sheet";
import { NotificationsSheet } from "./notifications-sheet";

const LINKS = [
  { href: "/studio", label: "Live" },
  { href: "/studio/detections", label: "Detections" },
  { href: "/studio/earnings", label: "Earnings" },
  { href: "/studio/schedule", label: "Schedule" },
  { href: "/studio/settings", label: "Settings" },
  { href: "/studio/demo", label: "Demo panel" },
];

export function StudioNav() {
  const path = usePathname();
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/studio/ticker")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { unreadNotifications?: number } | null) => !stop && d && setUnread(d.unreadNotifications ?? 0))
        .catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="font-bold tracking-tight">
          Seen <span className="text-muted-foreground">Studio</span>
        </Link>
        <nav aria-label="Studio" className="flex flex-1 flex-wrap gap-1 text-sm">
          {LINKS.map((l) => {
            const active = l.href === "/studio" ? path === "/studio" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-2.5 py-1.5 ${active ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setNotifOpen(true)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
            🔔{unread > 0 && <span className="ms-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{unread}</span>}
          </Button>
          <Button size="sm" onClick={() => setAssistantOpen(true)}>Ask Seen</Button>
        </div>
      </div>
      <NotificationsSheet open={notifOpen} onOpenChange={setNotifOpen} onRead={() => setUnread(0)} />
      <AssistantSheet open={assistantOpen} onOpenChange={setAssistantOpen} />
    </header>
  );
}
