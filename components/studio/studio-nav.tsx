"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, CalendarDays, FlaskConical, Radio, ScanSearch, Settings, Sparkles, Wallet } from "lucide-react";
import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { AssistantSheet } from "./assistant-sheet";
import { NotificationsSheet } from "./notifications-sheet";

const LINKS = [
  { href: "/studio", label: "Live", icon: Radio },
  { href: "/studio/detections", label: "Detections", icon: ScanSearch },
  { href: "/studio/earnings", label: "Earnings", icon: Wallet },
  { href: "/studio/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/studio/settings", label: "Settings", icon: Settings },
  { href: "/studio/demo", label: "Demo panel", icon: FlaskConical },
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
    <header className="sticky top-0 z-30 border-b bg-card/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        <Logo suffix="Studio" />
        <nav aria-label="Studio" className="-mx-1 flex flex-1 gap-0.5 overflow-x-auto text-sm">
          {LINKS.map((l) => {
            const active = l.href === "/studio" ? path === "/studio" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors ${
                  active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <l.icon className="size-4" aria-hidden />
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="relative"
            onClick={() => setNotifOpen(true)}
            aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
          >
            <Bell aria-hidden />
            {unread > 0 && (
              <span className="absolute -end-1.5 -top-1.5 grid min-w-4.5 place-items-center rounded-full bg-live px-1 text-[10px] font-semibold leading-4.5 text-white">
                {unread}
              </span>
            )}
          </Button>
          <Button className="brand-bg border-0 text-white hover:brightness-110" onClick={() => setAssistantOpen(true)}>
            <Sparkles aria-hidden />
            Ask Seen
          </Button>
        </div>
      </div>
      <NotificationsSheet open={notifOpen} onOpenChange={setNotifOpen} onRead={() => setUnread(0)} />
      <AssistantSheet open={assistantOpen} onOpenChange={setAssistantOpen} />
    </header>
  );
}
