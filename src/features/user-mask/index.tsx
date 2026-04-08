import { useState, useMemo, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { Users, Eye, EyeOff, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard, Spinner, EmptyState, ErrorAlert } from "@/components/shared/PageHeader";
import { useUsers, useUserMaskStats, useBulkMaskMutation } from "./hooks";
import { LeahUser, getUserMaskStatus } from "@/types";
import { cn, fmtDate } from "@/lib/utils";
import * as XLSX from "xlsx";

type Filter = "all" | "masked" | "unmasked";

const ROW_HEIGHT = 46; // px — keep in sync with row min-height

export default function UserMaskPage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const { data, isLoading, error, refetch } = useUsers();
  const mutation = useBulkMaskMutation();
  const users: LeahUser[] = data ?? [];
  const stats = useUserMaskStats(users);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter((u) => {
      const matchSearch =
        !q ||
        u.userName.toLowerCase().includes(q) ||
        u.fullName.toLowerCase().includes(q) ||
        (u.departmentName ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q);
      const status = getUserMaskStatus(u);
      const matchFilter = filter === "all" || status === filter;
      return matchSearch && matchFilter;
    });
  }, [users, search, filter]);

  // ── Virtual scrolling ─────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 30,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // ── Selection helpers ─────────────────────────────────────────────────────
  const allSelected = filtered.length > 0 && filtered.every((u) => selected.has(u.id));
  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) filtered.forEach((u) => next.delete(u.id));
      else filtered.forEach((u) => next.add(u.id));
      return next;
    });
  }, [allSelected, filtered]);

  const toggleOne = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const [confirmAction, setConfirmAction] = useState<{ action: "mask" | "unmask"; targets: LeahUser[] } | null>(null);

  const handleBulkAction = (action: "mask" | "unmask") => {
    const targets = selected.size > 0
      ? users.filter((u) => selected.has(u.id))
      : filtered;
    if (targets.length === 0) { toast.error("No users selected"); return; }
    setConfirmAction({ action, targets });
  };

  const executeAction = async () => {
    if (!confirmAction) return;
    const { action, targets } = confirmAction;
    setConfirmAction(null);
    setProgress({ done: 0, total: targets.length });
    try {
      const result = await mutation.mutateAsync({
        users: targets,
        action,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      toast.success(`${action === "mask" ? "Masked" : "Unmasked"} ${result.success} users`, {
        description: result.failed > 0 ? `${result.failed} failed — check console` : undefined,
      });
      setSelected(new Set());
    } catch (err) {
      toast.error("Operation failed", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setProgress(null);
    }
  };

  const exportCsv = () => {
    const rows = users.map((u) => ({
      "User ID": u.id,
      "Full Name": u.fullName,
      "Username (real)": u.userName,
      "Email (current)": u.email,
      "Status": getUserMaskStatus(u),
      "Department": u.departmentName,
      "Role": u.roleName,
      "Active": u.isActive ? "Yes" : "No",
      "Added On": fmtDate(u.addedOn),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Users");
    XLSX.writeFile(wb, `leah-users-mask-status-${Date.now()}.xlsx`);
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="User Email Mask / Unmask"
        description="Toggle email masking for all users. Mask = safe for UAT. Unmask = live notifications at go-live."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">Refresh</Button>
            <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
              <Download size={13} />Export
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="Total users" value={stats.total} />
        <StatCard label="Masked (UAT safe)" value={stats.masked} sub="email starts with 'x'" className="border border-amber-500/30" />
        <StatCard label="Unmasked (live)" value={stats.unmasked} sub="real email active" className="border border-green-500/30" />
      </div>

      {/* Loading progress bar (initial fetch) */}
      {isLoading && (
        <div className="mb-4 bg-muted rounded-lg p-3">
          <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
            <span>Fetching all users…</span>
          </div>
          <div className="h-1.5 bg-border rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full animate-pulse w-full" />
          </div>
        </div>
      )}

      {/* Bulk operation progress bar */}
      {progress && (
        <div className="mb-4 bg-muted rounded-lg p-3">
          <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
            <span>Processing users…</span>
            <span>{progress.done} / {progress.total}</span>
          </div>
          <div className="h-1.5 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex-1 min-w-48">
          <Input
            placeholder="Search by name, email, department…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "masked", "unmasked"] as Filter[]).map((f) => (
            <Button key={f} variant={filter === f ? "secondary" : "outline"} size="sm" onClick={() => setFilter(f)} className="capitalize h-9">
              {f}
            </Button>
          ))}
        </div>
        <div className="flex gap-2 ml-auto">
          <Button size="sm" variant="outline" onClick={() => handleBulkAction("mask")} disabled={mutation.isPending} className="gap-1.5 border-amber-500/40 text-amber-500 hover:bg-amber-500/10">
            <EyeOff size={13} />
            {selected.size > 0 ? `Mask ${selected.size}` : `Mask All (${filtered.length})`}
          </Button>
          <Button size="sm" onClick={() => handleBulkAction("unmask")} disabled={mutation.isPending} className="gap-1.5 bg-green-600 hover:bg-green-700 text-white">
            <Eye size={13} />
            {selected.size > 0 ? `Unmask ${selected.size}` : `Unmask All (${filtered.length})`}
          </Button>
        </div>
      </div>

      {/* Result count */}
      {!isLoading && users.length > 0 && (
        <div className="text-xs text-muted-foreground mb-2">
          Showing {filtered.length.toLocaleString()} of {users.length.toLocaleString()} users
        </div>
      )}

      {error && <ErrorAlert message={(error as Error).message} onRetry={() => refetch()} />}

      {isLoading && (
        <div className="flex justify-center py-20">
          <Spinner size={32} />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <EmptyState icon={<Users size={32} />} title="No users found" description="Try a different search or filter." />
      )}

      {/* Virtualized table */}
      {!isLoading && filtered.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden flex flex-col flex-1 min-h-0">
          {/* Fixed header */}
          <div className="bg-muted/50 border-b border-border grid grid-cols-[32px_1fr_1fr_160px_180px_80px] gap-0 flex-shrink-0">
            {["", "Username (real)", "Current email", "Department", "Role", "Status"].map((h, i) => (
              <div key={i} className={cn("px-3 py-2 text-xs font-medium text-muted-foreground", i === 0 && "flex items-center justify-center")}>
                {i === 0
                  ? <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
                  : h}
              </div>
            ))}
          </div>

          {/* Virtual scroll container */}
          <div
            ref={scrollRef}
            className="overflow-y-auto flex-1"
            style={{ height: Math.min(filtered.length * ROW_HEIGHT, 600) }}
          >
            {/* Total height spacer */}
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualItems.map((vRow) => {
                const user = filtered[vRow.index];
                const isMasked = getUserMaskStatus(user) === "masked";
                const isSel = selected.has(user.id);
                return (
                  <div
                    key={user.id}
                    data-index={vRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: vRow.start,
                      left: 0,
                      right: 0,
                      minHeight: ROW_HEIGHT,
                    }}
                    className={cn(
                      "grid grid-cols-[32px_1fr_1fr_160px_180px_80px] gap-0 border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors",
                      isSel && "bg-muted/50"
                    )}
                    onClick={() => toggleOne(user.id)}
                  >
                    <div className="px-3 flex items-center justify-center">
                      <input type="checkbox" checked={isSel} readOnly className="rounded" />
                    </div>
                    <div className="px-3 py-2.5 flex items-center">
                      <span className="mono text-xs text-muted-foreground truncate">{user.userName}</span>
                    </div>
                    <div className="px-3 py-2.5 flex items-center">
                      <span className={cn("mono text-xs truncate", isMasked ? "text-amber-500" : "text-green-500")}>
                        {user.email}
                      </span>
                    </div>
                    <div className="px-3 py-2.5 flex items-center">
                      <span className="text-xs text-muted-foreground truncate">{user.departmentName}</span>
                    </div>
                    <div className="px-3 py-2.5 flex items-center">
                      <span className="text-xs text-muted-foreground truncate">{user.roleName}</span>
                    </div>
                    <div className="px-3 py-2.5 flex items-center justify-center">
                      <Badge
                        variant={isMasked ? "outline" : "secondary"}
                        className={cn("text-[10px]", isMasked ? "border-amber-500/50 text-amber-500" : "text-green-500")}
                      >
                        {isMasked
                          ? <><EyeOff size={9} className="mr-1" />masked</>
                          : <><Eye size={9} className="mr-1" />live</>}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-fade-in">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className={cn(
                  "p-2 rounded-full",
                  confirmAction.action === "mask" ? "bg-amber-500/20 text-amber-500" : "bg-green-500/20 text-green-500"
                )}>
                  {confirmAction.action === "mask" ? <EyeOff size={20} /> : <Eye size={20} />}
                </div>
                <h3 className="text-lg font-semibold">Confirm Bulk Action</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Are you sure you want to <strong>{confirmAction.action === "mask" ? "mask" : "unmask"}</strong> {confirmAction.targets.length.toLocaleString()} user email(s)?
              </p>
              <p className="mt-2 text-xs text-muted-foreground italic">
                {confirmAction.action === "mask"
                  ? "This will add an 'x' prefix to the email addresses, preventing non-UAT notifications."
                  : "This will remove the 'x' prefix, enabling live notifications again."}
              </p>
            </div>
            <div className="bg-muted/50 px-6 py-4 flex gap-3 justify-end border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setConfirmAction(null)}>Cancel</Button>
              <Button
                size="sm"
                onClick={executeAction}
                className={cn(
                  confirmAction.action === "mask" ? "bg-amber-600 hover:bg-amber-700 font-medium" : "bg-green-600 hover:bg-green-700 font-medium"
                )}
              >
                Confirm {confirmAction.action === "mask" ? "Masking" : "Unmasking"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
