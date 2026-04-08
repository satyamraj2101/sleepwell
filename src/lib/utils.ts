import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO, isValid } from "date-fns";

// shadcn/ui standard utility
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format ISO date string for display
export function fmtDate(d: string | null | undefined, fmt = "dd MMM yyyy"): string {
  if (!d) return "—";
  try {
    const parsed = parseISO(d);
    return isValid(parsed) ? format(parsed, fmt) : "—";
  } catch {
    return "—";
  }
}

// Format ISO date for <input type="date">
export function toInputDate(d: string | null | undefined): string {
  if (!d) return "";
  return d.split("T")[0] ?? "";
}

// Stage → badge variant
export function stageToBadge(stage: string): "default" | "secondary" | "destructive" | "outline" {
  const s = stage.toLowerCase();
  if (s.includes("sign") || s.includes("signature")) return "default";
  if (s.includes("active") || s.includes("execut") || s.includes("complet")) return "secondary";
  if (s.includes("terminat") || s.includes("reject") || s.includes("expir")) return "destructive";
  return "outline";
}

// Detect if a user's email is masked (starts with 'x')
export function isEmailMasked(email: string): boolean {
  return email.startsWith("x");
}

// Toggle email mask
export function toggleEmailMask(email: string): string {
  return email.startsWith("x") ? email.slice(1) : `x${email}`;
}

// File download helper (for bulk import templates etc.)
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Truncate text
export function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// Extract error message from axios error or unknown
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "An unexpected error occurred";
}

// Chunk array into batches
export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// Build query key for TanStack Query
export const QK = {
  appTypes: (tenant: string) => ["appTypes", tenant] as const,
  appTypeById: (tenant: string, id: number) => ["appType", tenant, id] as const,
  intakeFields: (tenant: string, appTypeId: number) => ["intakeFields", tenant, appTypeId] as const,
  contracts: (tenant: string, appTypeId: number, page: number) => ["contracts", tenant, appTypeId, page] as const,
  contractDetail: (tenant: string, id: number) => ["contractDetail", tenant, id] as const,
  users: (tenant: string, page: number) => ["users", tenant, page] as const,
  legalParties: (tenant: string, page: number) => ["legalParties", tenant, page] as const,
  fieldDefs: (tenant: string, appTypeId?: number) => ["fieldDefs", tenant, appTypeId] as const,
  auditLog: (tenant: string, entityId: number) => ["auditLog", tenant, entityId] as const,
  approvals: (tenant: string, requestId: number) => ["approvals", tenant, requestId] as const,
  dateRules: (tenant: string, appTypeId?: number) => ["dateRules", tenant, appTypeId] as const,
  reports: (tenant: string) => ["reports", tenant] as const,
  scoreCard: (tenant: string, requestId: number) => ["scoreCard", tenant, requestId] as const,
  bulkTemplates: (tenant: string) => ["bulkTemplates", tenant] as const,
  departments: (tenant: string) => ["departments", tenant] as const,
} as const;
