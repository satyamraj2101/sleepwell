import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Edit2, Trash2, Copy, Layers, X, Loader2, Search, CheckCircle2, XCircle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Spinner, ErrorAlert } from "@/components/shared/PageHeader";
import { useApiClients } from "@/hooks/useApiClients";
import { useAuthStore } from "@/store/authStore";
import {
  listApplicationTypesNew,
  deleteApplicationType,
  createApplicationType,
  updateApplicationType,
} from "@/api/applicationTypes";
import { listApplicationsDropdown } from "@/api/departments";
import { QK } from "@/lib/utils";
import { ApplicationType } from "@/types";
import { cn } from "@/lib/utils";

interface AppTypeFormData {
  applicationTypeName: string;
  applicationId: number | "";
  description: string;
  isActive: boolean;
  isDefaultForRunAi: boolean;
  isWatermarkEnabled: boolean;
  isAutoConvertPDFToWord: boolean;
  isCrc: boolean;
  languageId: number;
}

const defaultForm: AppTypeFormData = {
  applicationTypeName: "",
  applicationId: "",
  description: "",
  isActive: true,
  isDefaultForRunAi: false,
  isWatermarkEnabled: false,
  isAutoConvertPDFToWord: false,
  isCrc: false,
  languageId: 1,
};

export default function AppTypeBuilderPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [modalState, setModalState] = useState<
    null | { mode: "create" } | { mode: "edit"; appType: ApplicationType } | { mode: "clone"; appType: ApplicationType }
  >(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ApplicationType | null>(null);

  const clients = useApiClients();
  const { tenant } = useAuthStore();
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...QK.appTypes(tenant), "new", page, search],
    queryFn: () =>
      listApplicationTypesNew(clients!.newCloud, tenant, {
        pageNumber: page,
        pageSize: 50,
        search: search || undefined,
      }),
    enabled: !!clients,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteApplicationType(clients!.newCloud, tenant, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.appTypes(tenant) });
      toast.success("Application type deleted");
      setDeleteConfirm(null);
    },
    onError: (e) => { toast.error((e as Error).message); setDeleteConfirm(null); },
  });

  const allTypes = data?.data ?? [];

  const isActive = (at: ApplicationType) => Boolean((at.isActive as any) === "Y" || at.isActive);

  const filtered = useMemo(() => {
    return allTypes.filter((at) => {
      if (statusFilter === "active") return isActive(at);
      if (statusFilter === "inactive") return !isActive(at);
      return true;
    });
  }, [allTypes, statusFilter]);

  const stats = useMemo(() => ({
    total: allTypes.length,
    active: allTypes.filter(isActive).length,
    inactive: allTypes.filter((a) => !isActive(a)).length,
  }), [allTypes]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Application Type Builder"
        description="Create, configure, and manage application types. Full CRUD via the New Cloud API."
        actions={
          <Button size="sm" onClick={() => setModalState({ mode: "create" })} className="gap-1.5 bg-amber-500 hover:bg-amber-400 text-black font-semibold">
            <Plus size={13} /> New App Type
          </Button>
        }
      />

      {/* Stats */}
      {!isLoading && allTypes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "Total", value: stats.total, filter: "all" as const },
            { label: "Active", value: stats.active, filter: "active" as const, color: "text-emerald-400" },
            { label: "Inactive", value: stats.inactive, filter: "inactive" as const, color: "text-zinc-500" },
          ].map(({ label, value, filter, color }) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(statusFilter === filter ? "all" : filter)}
              className={cn(
                "text-left bg-card border rounded-xl px-4 py-3 transition-all hover:border-border/80",
                statusFilter === filter ? "border-amber-500/40 bg-amber-500/5" : "border-border"
              )}
            >
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
              <p className={cn("text-2xl font-bold", color ?? "text-foreground")}>{value}</p>
            </button>
          ))}
        </div>
      )}

      {/* Search + filters */}
      <div className="flex gap-2 items-center flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search application types…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            onKeyDown={(e) => e.key === "Enter" && refetch()}
            className="h-9 pl-8 text-sm"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="h-9">Search</Button>
      </div>

      {error && <ErrorAlert message={(error as Error).message} onRetry={() => refetch()} />}
      {isLoading && <div className="flex justify-center py-16"><Spinner size={28} /></div>}

      {/* Table */}
      {!isLoading && (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Layers size={28} className="mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No application types found</p>
              <Button size="sm" onClick={() => setModalState({ mode: "create" })} className="gap-1.5 mt-4">
                <Plus size={12} /> Create one
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-20">ID</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Application</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-20">Status</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Stages</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-28">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((at) => {
                  const active = isActive(at);
                  return (
                    <tr key={at.applicationTypeId} className="hover:bg-muted/20 transition-colors group">
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono font-semibold text-amber-500">#{at.applicationTypeId}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[13px]">{at.applicationTypeName}</span>
                          {at.isDefaultForRunAi && (
                            <span className="text-[9px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded">AI</span>
                          )}
                        </div>
                        {at.description && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[280px]">{at.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-xs text-muted-foreground">{at.applicationName || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className={cn(
                          "flex items-center gap-1.5 text-[11px] font-semibold",
                          active ? "text-emerald-400" : "text-zinc-500"
                        )}>
                          {active
                            ? <CheckCircle2 size={12} />
                            : <XCircle size={12} />}
                          {active ? "Active" : "Inactive"}
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {(at.applicationStatuses ?? []).slice(0, 5).map((s) => (
                            <span key={s.statusId} className="text-[9px] bg-muted border border-border px-1.5 py-0.5 rounded font-medium">
                              {s.statusName}
                            </span>
                          ))}
                          {(at.applicationStatuses?.length ?? 0) > 5 && (
                            <span className="text-[9px] text-muted-foreground">+{at.applicationStatuses!.length - 5}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {/* Copy ID */}
                          <ActionBtn title="Copy ID" onClick={() => { navigator.clipboard.writeText(String(at.applicationTypeId)); toast.success(`ID ${at.applicationTypeId} copied`); }}>
                            <Copy size={12} />
                          </ActionBtn>
                          {/* Clone */}
                          <ActionBtn title="Clone" onClick={() => setModalState({ mode: "clone", appType: at })}>
                            <ChevronRight size={12} className="rotate-90" />
                          </ActionBtn>
                          {/* Edit */}
                          <ActionBtn title="Edit" onClick={() => setModalState({ mode: "edit", appType: at })}>
                            <Edit2 size={12} />
                          </ActionBtn>
                          {/* Delete */}
                          <ActionBtn title="Delete" onClick={() => setDeleteConfirm(at)} danger>
                            <Trash2 size={12} />
                          </ActionBtn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Pagination */}
      {(data?.totalRecords ?? 0) > 50 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {data?.totalRecords} types
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-sm text-muted-foreground self-center font-medium">Page {page}</span>
            <Button variant="outline" size="sm" disabled={allTypes.length < 50} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center">
                <Trash2 size={16} className="text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-[14px]">Delete App Type?</h3>
                <p className="text-xs text-muted-foreground mt-0.5">This cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-5 bg-muted/40 border border-border rounded-lg px-3 py-2 font-medium">
              {deleteConfirm.applicationTypeName} <span className="text-xs font-mono text-muted-foreground/60">#{deleteConfirm.applicationTypeId}</span>
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)} disabled={deleteMut.isPending}>Cancel</Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteMut.mutate(deleteConfirm.applicationTypeId)}
                disabled={deleteMut.isPending}
                className="gap-1.5"
              >
                {deleteMut.isPending && <Loader2 size={12} className="animate-spin" />}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit / Clone Modal */}
      {modalState && (
        <AppTypeFormModal
          mode={modalState.mode === "clone" ? "create" : modalState.mode}
          appType={"appType" in modalState ? modalState.appType : undefined}
          isClone={modalState.mode === "clone"}
          onClose={() => setModalState(null)}
          onSaved={() => {
            setModalState(null);
            qc.invalidateQueries({ queryKey: QK.appTypes(tenant) });
          }}
        />
      )}
    </div>
  );
}

// ─── Action button ─────────────────────────────────────────────────────────────
function ActionBtn({ children, title, onClick, danger }: {
  children: React.ReactNode; title: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        "p-1.5 rounded transition-colors",
        danger
          ? "text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      )}
    >
      {children}
    </button>
  );
}

// ─── Form Modal ────────────────────────────────────────────────────────────────
function AppTypeFormModal({
  mode, appType, isClone, onClose, onSaved,
}: {
  mode: "create" | "edit";
  appType?: ApplicationType;
  isClone?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const clients = useApiClients();
  const { tenant } = useAuthStore();

  const [form, setForm] = useState<AppTypeFormData>(() => {
    if (appType) {
      return {
        applicationTypeName: isClone ? `${appType.applicationTypeName} (Copy)` : appType.applicationTypeName,
        applicationId: appType.applicationId ?? "",
        description: appType.description ?? "",
        isActive: isClone ? false : Boolean((appType.isActive as any) === "Y" || appType.isActive),
        isDefaultForRunAi: appType.isDefaultForRunAi ?? false,
        isWatermarkEnabled: false,
        isAutoConvertPDFToWord: false,
        isCrc: false,
        languageId: 1,
      };
    }
    return defaultForm;
  });

  const { data: apps, isLoading: appsLoading } = useQuery({
    queryKey: ["applications", tenant],
    queryFn: () => listApplicationsDropdown(clients!.newCloud, tenant),
    enabled: !!clients,
    staleTime: 10 * 60_000,
  });

  const createMut = useMutation({
    mutationFn: () =>
      createApplicationType(clients!.newCloud, tenant, {
        ...form,
        applicationId: Number(form.applicationId),
        intakeFormFieldGroup: [],
        featureVisibility: [],
        callToActionVisibility: [],
      }),
    onSuccess: () => { toast.success(isClone ? "App type cloned" : "App type created"); onSaved(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateApplicationType(clients!.newCloud, tenant, appType!.applicationTypeId, {
        ...form,
        applicationId: Number(form.applicationId),
        intakeFormFieldGroup: [],
        featureVisibility: [],
        callToActionVisibility: [],
      }),
    onSuccess: () => { toast.success("App type updated"); onSaved(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const isPending = createMut.isPending || updateMut.isPending;
  const set = <K extends keyof AppTypeFormData>(k: K, v: AppTypeFormData[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = () => {
    if (!form.applicationTypeName.trim()) { toast.error("Name is required"); return; }
    if (!form.applicationId) { toast.error("Application is required"); return; }
    mode === "create" ? createMut.mutate() : updateMut.mutate();
  };

  const title = isClone
    ? `Clone: ${appType?.applicationTypeName}`
    : mode === "create"
    ? "New Application Type"
    : `Edit: ${appType?.applicationTypeName}`;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-2xl max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
            <div>
              <h3 className="font-semibold text-[14px]">{title}</h3>
              {mode === "edit" && appType && (
                <p className="text-[11px] text-muted-foreground font-mono mt-0.5">ID #{appType.applicationTypeId}</p>
              )}
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded">
              <X size={15} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Name */}
            <Field label="Application Type Name" required>
              <Input
                value={form.applicationTypeName}
                onChange={(e) => set("applicationTypeName", e.target.value)}
                placeholder="e.g. Dealer Agreement"
                className="h-9 text-sm"
                autoFocus
              />
            </Field>

            {/* Application */}
            <Field label="Application" required>
              {appsLoading ? (
                <div className="flex items-center gap-2 h-9 text-sm text-muted-foreground">
                  <Loader2 size={12} className="animate-spin" /> Loading…
                </div>
              ) : (
                <select
                  value={form.applicationId}
                  onChange={(e) => set("applicationId", e.target.value ? Number(e.target.value) : "")}
                  className="w-full h-9 text-sm bg-background border border-border rounded-md px-3 focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Select application…</option>
                  {(apps ?? []).map((app) => (
                    <option key={app.applicationId} value={app.applicationId}>
                      {app.applicationName} (#{app.applicationId})
                    </option>
                  ))}
                </select>
              )}
            </Field>

            {/* Description */}
            <Field label="Description">
              <Input
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Optional description"
                className="h-9 text-sm"
              />
            </Field>

            {/* Toggles */}
            <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
              <p className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">
                Settings
              </p>
              {([
                { k: "isActive" as const,              label: "Active",                   hint: "Visible to users" },
                { k: "isDefaultForRunAi" as const,     label: "Default for Run AI",       hint: "Used in AI analysis" },
                { k: "isWatermarkEnabled" as const,    label: "Watermark Enabled",        hint: "" },
                { k: "isAutoConvertPDFToWord" as const,label: "Auto Convert PDF → Word",  hint: "" },
                { k: "isCrc" as const,                 label: "CRC Enabled",              hint: "" },
              ] as const).map(({ k, label, hint }) => (
                <label key={k} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
                  <input
                    type="checkbox"
                    checked={form[k] as boolean}
                    onChange={(e) => set(k, e.target.checked)}
                    className="rounded accent-amber-500"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium">{label}</span>
                    {hint && <span className="text-[11px] text-muted-foreground ml-2">{hint}</span>}
                  </div>
                  {form[k] && <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />}
                </label>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-2 justify-end px-5 py-4 border-t border-border flex-shrink-0">
            <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isPending || !form.applicationTypeName.trim() || !form.applicationId}
              className="gap-1.5 bg-amber-500 hover:bg-amber-400 text-black font-semibold"
            >
              {isPending && <Loader2 size={12} className="animate-spin" />}
              {mode === "create" ? (isClone ? "Clone" : "Create") : "Update"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
