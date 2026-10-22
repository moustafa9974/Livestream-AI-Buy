import type { ReactNode } from "react";

/** Consistent page title block: small eyebrow, big title, optional description and actions. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1">
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold md:text-3xl">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Section heading used inside pages. */
export function SectionTitle({ id, children, aside }: { id?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 id={id} className="text-base font-semibold">{children}</h2>
      {aside}
    </div>
  );
}
