import { ReactNode } from "react";
import { cn } from "@/lib/utils";

// ── Page Header ───────────────────────────────────────────────────────────────
interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4 mb-6", className)}>
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────
interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-3 text-muted-foreground">{icon}</div>}
      <div className="text-sm font-medium mb-1">{title}</div>
      {description && <p className="text-xs text-muted-foreground max-w-xs mb-4">{description}</p>}
      {action}
    </div>
  );
}

// ── Loading Spinner ───────────────────────────────────────────────────────────
export function Spinner({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <div
      style={{ width: size, height: size }}
      className={cn("border-2 border-muted border-t-foreground rounded-full animate-spin", className)}
    />
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  className?: string;
}

export function StatCard({ label, value, sub, className }: StatCardProps) {
  return (
    <div className={cn("bg-muted/50 rounded-lg px-4 py-3", className)}>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-semibold leading-none">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

// ── Mono ID Badge ─────────────────────────────────────────────────────────────
export function IdBadge({ label, value, color = "amber" }: { label: string; value: string | number; color?: "amber" | "blue" | "muted" }) {
  const colorMap = {
    amber: "text-amber-500",
    blue:  "text-blue-400",
    muted: "text-muted-foreground",
  };
  return (
    <div className="flex items-center gap-1.5 bg-muted/60 border border-border rounded px-2 py-1">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className={cn("mono text-sm font-semibold", colorMap[color])}>#{value}</span>
    </div>
  );
}

// ── Error Alert ───────────────────────────────────────────────────────────────
export function ErrorAlert({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3 flex items-start gap-2">
      <span className="text-destructive text-sm flex-1">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="text-xs underline text-destructive flex-shrink-0">Retry</button>
      )}
    </div>
  );
}
