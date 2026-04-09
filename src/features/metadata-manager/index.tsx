import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Plus, Copy, ChevronDown, AlertTriangle, CheckCircle2, Search, X, Trash2,
  Edit2, Download, RefreshCw, Star, Eye, EyeOff, Loader2, GitBranch, List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { PageHeader, Spinner, ErrorAlert } from "@/components/shared/PageHeader";
import { useApiClients } from "@/hooks/useApiClients";
import { useAuthStore } from "@/store/authStore";
import {
  listFieldDefinitions,
  listFieldTypes,
  addFieldOption,
  deleteFieldOption,
  createFieldDefinition,
  updateFieldDefinition,
  deleteFieldDefinition,
} from "@/api/metadata";
import { getIntakeFormFields } from "@/api/contractRequest";
import { QK, cn } from "@/lib/utils";
import { FieldDefinition, FieldOption, FieldTypeInfo, AddUpdateFieldPayload, IntakeFormField, IntakeFormFieldGroup } from "@/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const METADATA_TYPES = [
  { id: 1, name: "Contract" },
  { id: 2, name: "Legal Party" },
  { id: 3, name: "Client" },
  { id: 4, name: "Other (4)" },
  { id: 8, name: "Other (8)" },
  { id: 9, name: "Other (9)" },
];

const DROPDOWN_LIKE_NAMES = [
  "dropdown", "select", "radiobutton", "radio", "multiselect",
  "checkboxgroup", "checkbox group",
];

function isDropdownLike(ft: string) {
  return DROPDOWN_LIKE_NAMES.includes((ft ?? "").toLowerCase());
}

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  dropdown:      { bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/30" },
  select:        { bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/30" },
  multiselect:   { bg: "bg-indigo-500/10",  text: "text-indigo-400",  border: "border-indigo-500/30" },
  radiobutton:   { bg: "bg-purple-500/10",  text: "text-purple-400",  border: "border-purple-500/30" },
  radio:         { bg: "bg-purple-500/10",  text: "text-purple-400",  border: "border-purple-500/30" },
  date:          { bg: "bg-orange-500/10",  text: "text-orange-400",  border: "border-orange-500/30" },
  datetime:      { bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/30" },
  text:          { bg: "bg-zinc-500/10",    text: "text-zinc-400",    border: "border-zinc-500/30" },
  multilinetext: { bg: "bg-zinc-500/10",    text: "text-zinc-400",    border: "border-zinc-500/30" },
  textarea:      { bg: "bg-zinc-500/10",    text: "text-zinc-400",    border: "border-zinc-500/30" },
  number:        { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
  currency:      { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
  checkbox:      { bg: "bg-teal-500/10",    text: "text-teal-400",    border: "border-teal-500/30" },
  checkboxgroup: { bg: "bg-teal-500/10",    text: "text-teal-400",    border: "border-teal-500/30" },
};

function typeColor(ft: string) {
  return TYPE_COLORS[(ft ?? "").toLowerCase()] ?? { bg: "bg-zinc-500/10", text: "text-zinc-400", border: "border-zinc-500/30" };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MetadataManagerPage() {
  const [tab, setTab] = useState<"metadata" | "intake">("metadata");
  const [selAppTypeId, setSelAppTypeId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [metaTypeFilter, setMetaTypeFilter] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Panel state
  const [panel, setPanel] = useState<"none" | "create" | "edit">("none");
  const [editingField, setEditingField] = useState<FieldDefinition | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<FieldDefinition | null>(null);

  const clients = useApiClients();
  const { tenant } = useAuthStore();
  const qc = useQueryClient();

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: appTypesRaw } = useQuery({
    queryKey: QK.appTypes(tenant),
    queryFn: async () => {
      const { listApplicationTypes } = await import("@/api/applicationTypes");
      return listApplicationTypes(clients!.oldProd, tenant, tenant);
    },
    enabled: !!clients,
    staleTime: 5 * 60_000,
  });

  const fieldQueryKey = QK.fieldDefs(tenant, selAppTypeId ?? undefined);

  const { data: fieldData, isLoading, error, refetch } = useQuery({
    queryKey: fieldQueryKey,
    queryFn: () => listFieldDefinitions(clients!.newCloud, tenant, {
      applicationTypeId: selAppTypeId ?? undefined,
      showOptions: true,
      pageSize: 500,
      metadataType: metaTypeFilter !== "all" ? metaTypeFilter : undefined,
    }),
    enabled: !!clients,
    staleTime: 2 * 60_000,
  });

  const { data: fieldTypes = [] } = useQuery({
    queryKey: ["fieldTypes", tenant],
    queryFn: () => listFieldTypes(clients!.newCloud, tenant),
    enabled: !!clients,
    staleTime: 10 * 60_000,
  });

  const { data: intakeGroups = [], isLoading: intakeLoading } = useQuery({
    queryKey: ["intakeFields", tenant, selAppTypeId],
    queryFn: () => getIntakeFormFields(clients!.newCloud, tenant, selAppTypeId!),
    enabled: !!clients && !!selAppTypeId && tab === "intake",
    staleTime: 2 * 60_000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const invalidate = () => qc.invalidateQueries({ queryKey: fieldQueryKey });

  const addOptMut = useMutation({
    mutationFn: (v: { fieldId: number; value: string; isDefault?: boolean }) =>
      addFieldOption(clients!.newCloud, tenant, {
        fieldId: v.fieldId,
        fieldOptionValue: v.value,
        isDefault: v.isDefault ?? false,
        isActive: true,
      }),
    onSuccess: () => { invalidate(); toast.success("Option added"); },
    onError: (e) => toast.error((e as Error).message),
  });

  const delOptMut = useMutation({
    mutationFn: (optionId: number) => deleteFieldOption(clients!.newCloud, tenant, optionId),
    onSuccess: () => { invalidate(); toast.success("Option removed"); },
    onError: (e) => toast.error((e as Error).message),
  });

  const delFieldMut = useMutation({
    mutationFn: (id: number) => deleteFieldDefinition(clients!.newCloud, tenant, id),
    onSuccess: () => {
      invalidate();
      setDeleteConfirm(null);
      toast.success("Field deleted");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // ── Data ──────────────────────────────────────────────────────────────────

  const allFields = fieldData?.data ?? [];

  const stats = useMemo(() => {
    const total = allFields.length;
    const dlFields = allFields.filter((f) => isDropdownLike(f.fieldType));
    const missingOpts = dlFields.filter((f) => !f.options?.length);
    const active = allFields.filter((f) => f.isActive);
    const inactive = total - active.length;
    return { total, dropdownLike: dlFields.length, missingOptions: missingOpts.length, active: active.length, inactive };
  }, [allFields]);

  const uniqueTypes = useMemo(() => {
    const set = new Set(allFields.map((f) => (f.fieldType ?? "").toLowerCase()).filter(Boolean));
    return Array.from(set).sort();
  }, [allFields]);

  const fields = useMemo(() => {
    const q = search.toLowerCase();
    return allFields.filter((f) => {
      if (q && !f.fieldDisplayName?.toLowerCase().includes(q) && !f.fieldName?.toLowerCase().includes(q) && !String(f.fieldId).includes(q)) return false;
      if (typeFilter !== "all" && (f.fieldType ?? "").toLowerCase() !== typeFilter) return false;
      if (activeFilter === "active" && !f.isActive) return false;
      if (activeFilter === "inactive" && f.isActive) return false;
      if (showMissingOnly && (!isDropdownLike(f.fieldType) || (f.options?.length ?? 0) > 0)) return false;
      return true;
    });
  }, [allFields, search, typeFilter, activeFilter, showMissingOnly]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openEdit(f: FieldDefinition) {
    setEditingField(f);
    setPanel("edit");
  }

  function openCreate() {
    setEditingField(null);
    setPanel("create");
  }

  function exportToExcel() {
    import("xlsx").then(({ utils, writeFile }) => {
      const rows = fields.map((f) => ({
        "Field ID": f.fieldId,
        "Display Name": f.fieldDisplayName,
        "Field Name": f.fieldName,
        "Field Type": f.fieldType,
        "App Type": f.applicationTypeName ?? "",
        "Metadata Type": f.metadataType,
        "Active": f.isActive ? "Yes" : "No",
        "Required": (f.isMandatoryField ?? f.isRequired) ? "Yes" : "No",
        "Visible": f.isVisible !== false ? "Yes" : "No",
        "Options Count": f.options?.length ?? 0,
        "Options": (f.options ?? []).map((o) => o.fieldOptionValue).join(", "),
        "Help Text": f.helpText ?? "",
      }));
      const ws = utils.json_to_sheet(rows);
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, "Fields");
      writeFile(wb, `metadata-fields-${tenant}-${Date.now()}.xlsx`);
      toast.success("Exported to Excel");
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <PageHeader
        title="Field (Metadata) Manager"
        description="Full CRUD on application type metadata fields, options, and intake form conditions."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()}>
              <RefreshCw size={13} /> Refresh
            </Button>
            {tab === "metadata" && (
              <>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={exportToExcel} disabled={fields.length === 0}>
                  <Download size={13} /> Export
                </Button>
                <Button size="sm" className="gap-1.5" onClick={openCreate}>
                  <Plus size={13} /> New Field
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Tab switcher */}
      <div className="flex items-center gap-1 border-b border-border pb-0">
        <TabBtn active={tab === "metadata"} onClick={() => setTab("metadata")} icon={<List size={12} />}>
          Metadata Fields
        </TabBtn>
        <TabBtn active={tab === "intake"} onClick={() => setTab("intake")} icon={<GitBranch size={12} />}>
          Intake Form Fields
          {tab === "intake" && !selAppTypeId && (
            <span className="ml-1.5 text-[9px] text-amber-400">(select app type)</span>
          )}
        </TabBtn>
      </div>

      {/* Shared app type filter */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={selAppTypeId ?? ""}
          onChange={(e) => { setSelAppTypeId(e.target.value ? Number(e.target.value) : null); }}
          className="h-9 text-sm bg-background border border-border rounded-md px-3 focus:outline-none focus:ring-1 focus:ring-ring min-w-[200px]"
        >
          <option value="">{tab === "intake" ? "— Select an application type —" : "All application types"}</option>
          {(appTypesRaw ?? []).map((at: any) => (
            <option key={at.applicationTypeId} value={at.applicationTypeId}>{at.applicationTypeName}</option>
          ))}
        </select>

        {tab === "metadata" && (
          <>
            <select
              value={metaTypeFilter}
              onChange={(e) => setMetaTypeFilter(e.target.value)}
              className="h-9 text-sm bg-background border border-border rounded-md px-3 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All metadata types</option>
              {METADATA_TYPES.map((mt) => (
                <option key={mt.id} value={mt.id}>{mt.name}</option>
              ))}
            </select>

            <div className="relative flex-1 min-w-[160px] max-w-sm">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name, ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8 pr-8 text-sm"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X size={13} />
                </button>
              )}
            </div>

            {showMissingOnly && (
              <button
                onClick={() => setShowMissingOnly(false)}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-red-400 bg-red-500/10 border border-red-500/30 px-2.5 py-1.5 rounded-full hover:bg-red-500/20 transition-colors"
              >
                <AlertTriangle size={10} /> Missing options only <X size={10} />
              </button>
            )}
          </>
        )}
      </div>

      {/* ── METADATA TAB ── */}
      {tab === "metadata" && (
        <>
          {/* Stats bar */}
          {!isLoading && allFields.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <StatTile label="Total" value={stats.total} />
              <StatTile label="Active" value={stats.active} accent="green" onClick={() => setActiveFilter(activeFilter === "active" ? "all" : "active")} active={activeFilter === "active"} />
              <StatTile label="Inactive" value={stats.inactive} accent={stats.inactive > 0 ? "amber" : "default"} onClick={() => setActiveFilter(activeFilter === "inactive" ? "all" : "inactive")} active={activeFilter === "inactive"} />
              <StatTile label="Dropdown / Radio" value={stats.dropdownLike} accent="blue" onClick={() => setTypeFilter(typeFilter !== "all" ? "all" : "dropdown")} active={false} />
              <StatTile
                label="Missing Options"
                value={stats.missingOptions}
                accent={stats.missingOptions > 0 ? "red" : "green"}
                icon={stats.missingOptions > 0 ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
                onClick={() => setShowMissingOnly((v) => !v)}
                active={showMissingOnly}
              />
            </div>
          )}

          {/* Type filter chips */}
          {uniqueTypes.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              <FilterChip active={typeFilter === "all"} onClick={() => setTypeFilter("all")}>All types</FilterChip>
              {uniqueTypes.map((t) => {
                const c = typeColor(t);
                return (
                  <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(typeFilter === t ? "all" : t)} inactiveClass={c.text}>
                    {t}
                  </FilterChip>
                );
              })}
            </div>
          )}

          {!isLoading && (
            <p className="text-xs text-muted-foreground">
              Showing {fields.length}{allFields.length !== fields.length ? ` of ${allFields.length}` : ""} field{fields.length !== 1 ? "s" : ""}
              {fieldData?.totalRecords && fieldData.totalRecords > allFields.length ? ` (${fieldData.totalRecords} total in API)` : ""}
            </p>
          )}

          {error && <ErrorAlert message={(error as Error).message} onRetry={() => refetch()} />}
          {isLoading && <div className="flex justify-center py-20"><Spinner size={28} /></div>}

          {!isLoading && (
            <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
              {/* Table header */}
              {fields.length > 0 && (
                <div
                  className="grid items-center gap-2 px-3 py-1.5 bg-muted/40 border-b border-border text-[9px] font-semibold text-muted-foreground uppercase tracking-wider"
                  style={{ gridTemplateColumns: "14px 1fr auto auto auto auto auto" }}
                >
                  <span />
                  <span>Field</span>
                  <span>Type</span>
                  <span className="text-center">A · R · V</span>
                  <span className="text-right">Opts</span>
                  <span className="text-right">ID</span>
                  <span />
                </div>
              )}
              {fields.length === 0 && (
                <div className="py-20 text-center text-sm text-muted-foreground">
                  {allFields.length === 0 ? "No fields found. Try changing filters or select an app type." : "No fields match the current filters."}
                </div>
              )}
              {fields.map((f) => (
                <FieldRow
                  key={f.fieldId}
                  field={f}
                  expanded={expandedIds.has(f.fieldId)}
                  onToggle={() => toggleExpand(f.fieldId)}
                  onEdit={() => openEdit(f)}
                  onDelete={() => setDeleteConfirm(f)}
                  onAddOption={(value) => addOptMut.mutate({ fieldId: f.fieldId, value })}
                  onDeleteOption={(optId) => delOptMut.mutate(optId)}
                  addingOption={addOptMut.isPending}
                  deletingOption={delOptMut.isPending}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── INTAKE FIELDS TAB ── */}
      {tab === "intake" && (
        <IntakeFieldsPanel
          groups={intakeGroups}
          isLoading={intakeLoading}
          hasAppType={!!selAppTypeId}
        />
      )}

      {/* Side panel — fixed overlay so it doesn't affect layout */}
      {panel !== "none" && (
        <div className="fixed inset-y-0 right-0 z-40 w-[440px] border-l border-border bg-background/95 backdrop-blur-sm flex flex-col shadow-2xl">
          <FieldFormPanel
            mode={panel}
            field={editingField}
            fieldTypes={fieldTypes}
            appTypes={appTypesRaw ?? []}
            tenant={tenant}
            clients={clients}
            onClose={() => { setPanel("none"); setEditingField(null); }}
            onSaved={() => { invalidate(); setPanel("none"); setEditingField(null); }}
          />
        </div>
      )}
      {panel !== "none" && (
        <div className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[1px]" onClick={() => { setPanel("none"); setEditingField(null); }} />
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 p-2 bg-red-500/10 rounded-lg">
                <Trash2 size={16} className="text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Delete Field</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Are you sure you want to delete <strong className="text-foreground">"{deleteConfirm.fieldDisplayName || deleteConfirm.fieldName}"</strong>?
                  This will also remove all its options and cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={delFieldMut.isPending}
                onClick={() => delFieldMut.mutate(deleteConfirm.fieldId)}
              >
                {delFieldMut.isPending ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Trash2 size={13} className="mr-1.5" />}
                Delete Field
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Field Row ────────────────────────────────────────────────────────────────

interface FieldRowProps {
  field: FieldDefinition;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddOption: (value: string) => void;
  onDeleteOption: (optionId: number) => void;
  addingOption: boolean;
  deletingOption: boolean;
}

function FieldRow({ field: f, expanded, onToggle, onEdit, onDelete, onAddOption, onDeleteOption, addingOption, deletingOption }: FieldRowProps) {
  const [newOpt, setNewOpt] = useState("");
  const [showAddOpt, setShowAddOpt] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tc = typeColor(f.fieldType);
  const needsOptions = isDropdownLike(f.fieldType);
  const optCount = f.options?.length ?? 0;
  const isMissing = needsOptions && optCount === 0;
  const isRequired = f.isMandatoryField ?? f.isRequired;

  function submitOption() {
    const v = newOpt.trim();
    if (!v) return;
    onAddOption(v);
    setNewOpt("");
    setShowAddOpt(false);
  }

  return (
    <div className={cn("bg-card transition-colors group", isMissing && "bg-red-500/[0.03]")}>
      {/* ── Dense table row ── */}
      <div
        className="grid items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors select-none"
        style={{ gridTemplateColumns: "14px 1fr auto auto auto auto auto" }}
        onClick={onToggle}
      >
        {/* Expand chevron */}
        <ChevronDown size={12} className={cn("text-muted-foreground/40 transition-transform duration-150 flex-shrink-0", expanded && "rotate-180")} />

        {/* Name + API name */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn("text-[13px] font-medium text-foreground truncate", !f.isActive && "opacity-50 line-through")}>
               {f.fieldDisplayName || f.fieldName}
            </span>
            {isMissing && <AlertTriangle size={10} className="text-red-400 flex-shrink-0" />}
          </div>
          <p className="text-[10px] font-mono text-muted-foreground/40 truncate">{f.fieldName}</p>
        </div>

        {/* Type badge */}
        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 whitespace-nowrap", tc.bg, tc.text, tc.border)}>
          {f.fieldType || "—"}
        </span>

        {/* Status dots — Active · Required · Visible */}
        <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <StatusDot active={f.isActive} label={f.isActive ? "Active" : "Inactive"} color={f.isActive ? "green" : "gray"} />
          <StatusDot active={!!isRequired} label={isRequired ? "Required" : "Optional"} color={isRequired ? "amber" : "gray"} />
          <StatusDot active={f.isVisible !== false} label={f.isVisible !== false ? "Visible" : "Hidden"} color={f.isVisible !== false ? "blue" : "gray"} />
        </div>

        {/* Options count */}
        {needsOptions ? (
          <span
            className={cn("text-[10px] font-semibold tabular-nums w-10 text-right flex-shrink-0", optCount === 0 ? "text-red-400" : "text-muted-foreground/50")}
            title={`${optCount} option${optCount !== 1 ? "s" : ""}`}
          >
            {optCount} opt
          </span>
        ) : <span className="w-10" />}

        {/* ID */}
        <span className="text-[9px] font-mono text-muted-foreground/30 w-8 text-right flex-shrink-0">#{f.fieldId}</span>

        {/* Actions */}
        <div className="flex items-center gap-0 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          <IconBtn title="Edit" onClick={onEdit}><Edit2 size={11} /></IconBtn>
          <IconBtn title="Copy ID" onClick={() => { navigator.clipboard.writeText(String(f.fieldId)); toast.success(`Copied #${f.fieldId}`); }}><Copy size={11} /></IconBtn>
          <IconBtn title="Delete" className="text-red-400/70 hover:text-red-300 hover:bg-red-500/10" onClick={onDelete}><Trash2 size={11} /></IconBtn>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 pt-2 border-t border-border/40 bg-muted/10 space-y-2">
          {/* Two-column layout: flags + meta on left, options on right */}
          <div className="flex gap-4">
            {/* Left: flags + meta */}
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex flex-wrap gap-1">
                <VisFlag active={f.isVisible !== false} label="Visible" />
                <VisFlag active={f.isVisibleOnRequestDetails !== false} label="Req Details" />
                <VisFlag active={f.displayInRequestJourney === true} label="Journey" />
                <VisFlag active={f.displayInRequestDetails === true} label="In Details" />
                {f.isForAllApplicationTypes && <VisFlag active={true} label="All Types" />}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] font-mono text-muted-foreground/50">
                {f.fieldTypeId && <span>TypeID: {f.fieldTypeId}</span>}
                {f.metadataType && <span>MetaType: {f.metadataType}</span>}
                {f.applicationTypeName && <span>AppType: {f.applicationTypeName}</span>}
                {f.fieldGroup && <span>Group: {f.fieldGroup}</span>}
              </div>
              {f.helpText && (
                <p className="text-[10px] text-muted-foreground/70 bg-muted/40 rounded px-2 py-1 border border-border/30">
                  {f.helpText}
                </p>
              )}
            </div>
          </div>

          {/* Options section */}
          {needsOptions && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Options ({optCount})
                </p>
                <button
                  className="text-[10px] text-amber-400 hover:text-amber-300 font-medium flex items-center gap-1 transition-colors"
                  onClick={() => { setShowAddOpt(true); setTimeout(() => inputRef.current?.focus(), 50); }}
                >
                  <Plus size={10} /> Add option
                </button>
              </div>

              {/* Option list */}
              {optCount > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {f.options!.map((o) => (
                    <OptionChip
                      key={o.fieldOptionId}
                      option={o}
                      onDelete={() => onDeleteOption(o.fieldOptionId)}
                      deleting={deletingOption}
                    />
                  ))}
                </div>
              )}

              {/* No options warning */}
              {optCount === 0 && !showAddOpt && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                  <AlertTriangle size={12} className="text-red-400 flex-shrink-0" />
                  <span>No options — this field renders as an empty dropdown.</span>
                  <button
                    onClick={() => { setShowAddOpt(true); setTimeout(() => inputRef.current?.focus(), 50); }}
                    className="text-amber-400 hover:text-amber-300 font-medium"
                  >
                    Add first →
                  </button>
                </div>
              )}

              {/* Add option form */}
              {showAddOpt && (
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    ref={inputRef}
                    placeholder="Option label…"
                    value={newOpt}
                    onChange={(e) => setNewOpt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitOption();
                      if (e.key === "Escape") { setShowAddOpt(false); setNewOpt(""); }
                    }}
                    className="h-8 text-sm flex-1 max-w-[240px]"
                  />
                  <Button size="sm" className="h-8 gap-1" disabled={!newOpt.trim() || addingOption} onClick={submitOption}>
                    {addingOption ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                    Add
                  </Button>
                  <button onClick={() => { setShowAddOpt(false); setNewOpt(""); }} className="text-muted-foreground hover:text-foreground p-1">
                    <X size={13} />
                  </button>
                  <span className="text-[9px] text-muted-foreground hidden sm:block">Enter · Esc</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Option chip with delete ──────────────────────────────────────────────────

function OptionChip({ option: o, onDelete, deleting }: { option: FieldOption; onDelete: () => void; deleting: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors",
        o.isDefault
          ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
          : "bg-background border-border text-foreground/80"
      )}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {o.isDefault && <Star size={9} className="text-amber-400" />}
      <span>{o.fieldOptionValue}</span>
      <span className="text-[8px] font-mono text-muted-foreground/40">#{o.fieldOptionId}</span>
      {hov && (
        <button
          onClick={onDelete}
          disabled={deleting}
          className="ml-0.5 text-red-400 hover:text-red-300 transition-colors"
          title="Remove option"
        >
          <X size={9} />
        </button>
      )}
    </span>
  );
}

// ─── Field Form Panel (create / edit) ─────────────────────────────────────────

interface FieldFormPanelProps {
  mode: "create" | "edit";
  field: FieldDefinition | null;
  fieldTypes: FieldTypeInfo[];
  appTypes: any[];
  tenant: string;
  clients: any;
  onClose: () => void;
  onSaved: () => void;
}

type FieldFormValues = {
  fieldName: string;
  displayName: string;
  fieldTypeId: string;
  metadataType: string;
  applicationTypeIds: string; // comma-separated
  isMandatoryField: boolean;
  isActive: boolean;
  isVisible: boolean;
  isVisibleOnRequestDetails: boolean;
  displayInRequestJourney: boolean;
  displayInRequestDetails: boolean;
  isForAllApplicationTypes: boolean;
  helpText: string;
  comments: string;
  fieldGroup: string;
};

function FieldFormPanel({ mode, field, fieldTypes, appTypes, tenant, clients, onClose, onSaved }: FieldFormPanelProps) {
  const defaultValues: FieldFormValues = {
    fieldName: field?.fieldName ?? "",
    displayName: field?.fieldDisplayName ?? "",
    fieldTypeId: field?.fieldTypeId ? String(field.fieldTypeId) : (fieldTypes[0] ? String(fieldTypes[0].fieldTypeId) : ""),
    metadataType: field?.metadataType ? String(field.metadataType) : "1",
    applicationTypeIds: (() => {
      const ids = field?.applicationTypeIds;
      if (Array.isArray(ids) && ids.length > 0) return ids.join(",");
      if (field?.applicationTypeId) return String(field.applicationTypeId);
      return "";
    })(),
    isMandatoryField: field?.isMandatoryField ?? field?.isRequired ?? false,
    isActive: field?.isActive ?? true,
    isVisible: field?.isVisible ?? true,
    isVisibleOnRequestDetails: field?.isVisibleOnRequestDetails ?? true,
    displayInRequestJourney: field?.displayInRequestJourney ?? false,
    displayInRequestDetails: field?.displayInRequestDetails ?? false,
    isForAllApplicationTypes: field?.isForAllApplicationTypes ?? false,
    helpText: field?.helpText ?? "",
    comments: field?.comments ?? "",
    fieldGroup: field?.fieldGroup ?? "",
  };

  const { register, handleSubmit, watch, setValue, getValues, formState: { errors, isSubmitting } } = useForm<FieldFormValues>({ defaultValues });

  // Populate fieldTypeId once fieldTypes load (they may arrive after panel opens)
  useEffect(() => {
    if (fieldTypes.length > 0) {
      const cur = getValues("fieldTypeId");
      if (!cur) setValue("fieldTypeId", String(fieldTypes[0].fieldTypeId));
    }
  }, [fieldTypes.length]);

  const saveMut = useMutation({
    mutationFn: async (data: FieldFormValues) => {
      const appTypeIds = data.applicationTypeIds
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0);

      const payload: AddUpdateFieldPayload = {
        fieldId: mode === "edit" ? (field?.fieldId ?? 0) : 0,
        fieldType: parseInt(data.fieldTypeId, 10),
        fieldName: data.fieldName.trim(),
        displayName: data.displayName.trim(),
        metadataType: parseInt(data.metadataType, 10),
        applicationTypeIds: appTypeIds,
        isMandatoryField: data.isMandatoryField,
        isActive: data.isActive,
        isVisible: data.isVisible,
        isVisibleOnRequestDetails: data.isVisibleOnRequestDetails,
        displayInRequestJourney: data.displayInRequestJourney,
        displayInRequestDetails: data.displayInRequestDetails,
        isForAllApplicationTypes: data.isForAllApplicationTypes,
        helpText: data.helpText || undefined,
        comments: data.comments || undefined,
        fieldGroup: data.fieldGroup || undefined,
        options: mode === "edit" ? (field?.options ?? []).map((o, idx) => ({
          id: o.fieldOptionId,
          value: o.fieldOptionValue,
          isDefault: o.isDefault,
          fieldId: field!.fieldId,
          parentId: o.parentId,
          numericValue: o.numericValue,
          fieldOptionOrderId: o.fieldOptionOrderId || idx + 1,
          isActive: o.isActive,
        })) : [],
      };

      if (mode === "create") {
        await createFieldDefinition(clients!.newCloud, tenant, payload);
      } else {
        await updateFieldDefinition(clients!.newCloud, tenant, payload);
      }
    },
    onSuccess: () => {
      toast.success(mode === "create" ? "Field created" : "Field updated");
      onSaved();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const isForAll = watch("isForAllApplicationTypes");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div>
          <h3 className="font-semibold text-sm text-foreground">
            {mode === "create" ? "Create New Field" : "Edit Field"}
          </h3>
          {field && <p className="text-[10px] font-mono text-muted-foreground">#{field.fieldId}</p>}
        </div>
        <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors">
          <X size={15} />
        </button>
      </div>

      {/* Form body */}
      <form onSubmit={handleSubmit((d) => saveMut.mutateAsync(d))} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Display Name */}
        <FormField label="Display Name" required error={errors.fieldName?.message}>
          <Input
            {...register("displayName", { required: "Display name is required" })}
            placeholder="Human-readable label"
            className="h-8 text-sm"
          />
        </FormField>

        {/* Field Name */}
        <FormField label="Field Name (API key)" required error={errors.fieldName?.message}>
          <Input
            {...register("fieldName", { required: "Field name is required" })}
            placeholder="e.g. contractValue"
            className="h-8 text-sm font-mono"
          />
        </FormField>

        {/* Field Type */}
        <FormField label="Field Type" required>
          <select {...register("fieldTypeId")} className="w-full h-8 text-sm bg-background border border-border rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-ring">
            {fieldTypes.length === 0 && <option value="">Loading…</option>}
            {fieldTypes.map((ft) => (
              <option key={ft.fieldTypeId} value={ft.fieldTypeId}>{ft.fieldTypeName}</option>
            ))}
          </select>
        </FormField>

        {/* Metadata Type */}
        <FormField label="Metadata Type">
          <select {...register("metadataType")} className="w-full h-8 text-sm bg-background border border-border rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-ring">
            {METADATA_TYPES.map((mt) => (
              <option key={mt.id} value={mt.id}>{mt.name}</option>
            ))}
          </select>
        </FormField>

        {/* Application Types */}
        <FormField label="Application Type IDs" hint="Comma-separated. Leave blank if 'All App Types' is on.">
          <div className="flex items-center gap-2">
            <Input
              {...register("applicationTypeIds")}
              placeholder="e.g. 12,34,56"
              disabled={isForAll}
              className="h-8 text-sm font-mono flex-1"
            />
          </div>
          {appTypes.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {appTypes.slice(0, 12).map((at: any) => (
                <button
                  key={at.applicationTypeId}
                  type="button"
                  onClick={() => {/* handled via register */}}
                  className="text-[9px] font-mono bg-muted border border-border px-1.5 py-0.5 rounded hover:bg-muted/80 transition-colors"
                  title={`ID: ${at.applicationTypeId}`}
                >
                  {at.applicationTypeName} ({at.applicationTypeId})
                </button>
              ))}
            </div>
          )}
        </FormField>

        {/* Toggles */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Settings</p>
          <ToggleRow label="For All Application Types" name="isForAllApplicationTypes" register={register} />
          <ToggleRow label="Mandatory / Required" name="isMandatoryField" register={register} />
          <ToggleRow label="Active" name="isActive" register={register} />
          <ToggleRow label="Visible" name="isVisible" register={register} />
          <ToggleRow label="Visible on Request Details" name="isVisibleOnRequestDetails" register={register} />
          <ToggleRow label="Display in Request Journey" name="displayInRequestJourney" register={register} />
          <ToggleRow label="Display in Request Details" name="displayInRequestDetails" register={register} />
        </div>

        {/* Help Text */}
        <FormField label="Help Text" hint="Shown below the field in forms.">
          <textarea
            {...register("helpText")}
            rows={2}
            placeholder="Optional guidance text…"
            className="w-full text-sm bg-background border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </FormField>

        {/* Field Group */}
        <FormField label="Field Group">
          <Input
            {...register("fieldGroup")}
            placeholder="e.g. Financial, Legal…"
            className="h-8 text-sm"
          />
        </FormField>

        {/* Comments */}
        <FormField label="Comments">
          <textarea
            {...register("comments")}
            rows={2}
            placeholder="Internal notes…"
            className="w-full text-sm bg-background border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </FormField>

        {/* Spacer */}
        <div className="h-4" />
      </form>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border flex-shrink-0">
        <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting || saveMut.isPending}>
          Cancel
        </Button>
        <Button size="sm" type="submit" form="" disabled={isSubmitting || saveMut.isPending}
          onClick={handleSubmit((d) => saveMut.mutateAsync(d))}
        >
          {(isSubmitting || saveMut.isPending) && <Loader2 size={13} className="animate-spin mr-1.5" />}
          {mode === "create" ? "Create Field" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────────────────

function StatTile({
  label, value, accent = "default", icon, onClick, active,
}: {
  label: string; value: number; accent?: "blue" | "red" | "green" | "amber" | "default";
  icon?: React.ReactNode; onClick?: () => void; active?: boolean;
}) {
  const colors = {
    blue: "text-blue-400",
    red: value > 0 ? "text-red-400" : "text-emerald-400",
    green: "text-emerald-400",
    amber: value > 0 ? "text-amber-400" : "text-muted-foreground",
    default: "text-foreground",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "text-left bg-card border rounded-xl px-3 py-2.5 transition-all",
        onClick ? "cursor-pointer hover:border-border/80" : "cursor-default",
        active ? "border-amber-500/40 bg-amber-500/5 ring-1 ring-amber-500/20" : "border-border"
      )}
    >
      <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <div className={cn("text-xl font-bold flex items-center gap-1", colors[accent])}>
        {value}
        {icon}
      </div>
    </button>
  );
}

function FilterChip({ children, active, onClick, inactiveClass }: {
  children: React.ReactNode; active: boolean; onClick: () => void; inactiveClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-all capitalize",
        active
          ? "bg-foreground text-background border-foreground"
          : cn("bg-transparent border-border text-muted-foreground hover:border-foreground/40", inactiveClass)
      )}
    >
      {children}
    </button>
  );
}

function IconBtn({ children, title, onClick, className }: {
  children: React.ReactNode; title: string; onClick: () => void; className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn("p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors", className)}
    >
      {children}
    </button>
  );
}

function StatusDot({ active, label, color }: { active: boolean; label: string; color: "green" | "gray" | "amber" | "blue" }) {
  const colors = {
    green: active ? "bg-emerald-500" : "bg-zinc-600",
    gray: active ? "bg-zinc-400" : "bg-zinc-700",
    amber: active ? "bg-amber-500" : "bg-zinc-600",
    blue: active ? "bg-blue-500" : "bg-zinc-600",
  };
  return (
    <div
      title={label}
      className={cn(
        "w-1.5 h-1.5 rounded-full transition-colors",
        colors[color],
        !active && "opacity-40"
      )}
    />
  );
}

function VisFlag({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border",
      active
        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
        : "bg-muted/40 border-border/50 text-muted-foreground/40"
    )}>
      {active ? <Eye size={8} /> : <EyeOff size={8} />}
      {label}
    </span>
  );
}

function FormField({ label, children, required, error, hint }: {
  label: string; children: React.ReactNode; required?: boolean; error?: string; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground/60">{hint}</p>}
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}

function ToggleRow({ label, name, register }: { label: string; name: string; register: any }) {
  return (
    <label className="flex items-center justify-between cursor-pointer py-0.5 group">
      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
      <input type="checkbox" {...register(name)} className="w-3.5 h-3.5 accent-primary" />
    </label>
  );
}

function TabBtn({ children, active, onClick, icon }: {
  children: React.ReactNode; active: boolean; onClick: () => void; icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Intake Fields Panel ──────────────────────────────────────────────────────

function IntakeFieldsPanel({
  groups,
  isLoading,
  hasAppType,
}: {
  groups: IntakeFormFieldGroup[];
  isLoading: boolean;
  hasAppType: boolean;
}) {
  const [expandedFields, setExpandedFields] = useState<Set<number>>(new Set());

  function toggleField(id: number) {
    setExpandedFields((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (!hasAppType) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        <GitBranch size={32} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">Select an application type above to view its intake form fields.</p>
      </div>
    );
  }

  if (isLoading) {
    return <div className="flex justify-center py-20"><Spinner size={28} /></div>;
  }

  if (groups.length === 0) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        No intake form field groups found for this application type.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group, gi) => {
        const allFields: IntakeFormField[] = (group.sections ?? []).flatMap((s) => s.fields ?? []);

        return (
          <div key={gi} className="border border-border rounded-xl overflow-hidden">
            {/* Group header */}
            <div className="bg-muted/30 px-4 py-2.5 border-b border-border flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-foreground">{(group as any).groupName || (group as any).name || `Group ${gi + 1}`}</h4>
                {(group as any).groupType && (
                  <span className="text-[10px] text-muted-foreground font-mono">{(group as any).groupType}</span>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground">{allFields.length} field{allFields.length !== 1 ? "s" : ""}</span>
            </div>

            {/* Section labels */}
            {(group.sections ?? []).map((section, si) => (
              <div key={si}>
                {section.fields && section.fields.length > 0 && (
                  <div className="px-4 py-1.5 bg-muted/10 border-b border-border/50">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      {(section as any).sectionName || (section as any).name || `Section ${si + 1}`}
                    </span>
                  </div>
                )}
                <div className="divide-y divide-border/50">
                  {(section.fields ?? []).map((f) => (
                    <IntakeFieldRow
                      key={f.fieldId}
                      field={f}
                      expanded={expandedFields.has(f.fieldId)}
                      onToggle={() => toggleField(f.fieldId)}
                    />
                  ))}
                </div>
              </div>
            ))}

          </div>
        );
      })}
    </div>
  );
}

function IntakeFieldRow({ field: f, expanded, onToggle }: {
  field: IntakeFormField; expanded: boolean; onToggle: () => void;
}) {
  const tc = typeColor(f.fieldType ?? (f as any).type ?? "");
  const ft = f.fieldType ?? (f as any).type ?? "";
  
  let conditions: any[] = [];
  if (Array.isArray(f.visibilityConditions)) {
    conditions = f.visibilityConditions;
  } else if ((f as any).visibilityConditionObject?.rules) {
    conditions = (f as any).visibilityConditionObject.rules;
  } else if (typeof (f as any).visibilityConditions === 'string' && ((f as any).visibilityConditions as string).startsWith('{')) {
    try {
      const parsed = JSON.parse((f as any).visibilityConditions);
      if (parsed && Array.isArray(parsed.rules)) conditions = parsed.rules;
    } catch(e) {}
  }
  
  const hasConditions = conditions.length > 0;
  const selectOptCount = f.selectOptions ? Object.keys(f.selectOptions).length : 0;

  return (
    <div className="bg-card group">
      <div
        className="flex items-center gap-2.5 px-4 py-2.5 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={onToggle}
      >
        <ChevronDown
          size={12}
          className={cn("text-muted-foreground/40 flex-shrink-0 transition-transform", expanded && "rotate-180")}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn("text-sm font-medium", (f as any).isActive === false && "opacity-50 line-through")}>
               {f.displayName || f.fieldName}
            </span>
            {f.isRequired && (
              <span className="text-[9px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">Required</span>
            )}
            {(f as any).isReadOnly && (
              <span className="text-[9px] text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded">Read-only</span>
            )}
            {!f.isVisible && (
              <span className="text-[9px] text-muted-foreground bg-muted border border-border px-1.5 py-0.5 rounded">Hidden</span>
            )}
            {hasConditions && (
              <span className="inline-flex items-center gap-0.5 text-[9px] text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded">
                <GitBranch size={8} /> {conditions.length} condition{conditions.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-[10px] font-mono text-muted-foreground/50">{f.fieldName} · #{f.fieldId}</p>
        </div>

        {ft && (
          <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded border flex-shrink-0", tc.bg, tc.text, tc.border)}>
            {ft}
          </span>
        )}

        {selectOptCount > 0 && (
          <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">{selectOptCount} opts</span>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(String(f.fieldId)); toast.success(`Copied #${f.fieldId}`); }}
          className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground rounded transition-all"
        >
          <Copy size={11} />
        </button>
      </div>

      {/* Expanded: details + conditions */}
      {expanded && (
        <div className="px-4 pb-3 pt-1 border-t border-border/30 bg-muted/10 space-y-3">
          {/* Flags row */}
          <div className="flex flex-wrap gap-1.5">
            <VisFlag active={f.isRequired ?? false} label="Required" />
            <VisFlag active={f.isVisible ?? true} label="Visible" />
            <VisFlag active={!((f as any).isReadOnly ?? false)} label="Editable" />
            <VisFlag active={(f as any).isActive ?? true} label="Active" />
            {(f as any).isMultipleAllowed && <VisFlag active={true} label="Multi-value" />}
          </div>

          {/* Meta */}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] font-mono text-muted-foreground/50">
            <span>ID: {f.fieldId}</span>
            {(f as any).sortOrder != null && <span>Order: {(f as any).sortOrder}</span>}
            {(f as any).metaDataType && <span>MetaType: {(f as any).metaDataType}</span>}
            {(f as any).fieldGroup && <span>Group: {(f as any).fieldGroup}</span>}
          </div>

          {/* Help text */}
          {f.helpText && (
            <p className="text-[11px] text-muted-foreground bg-muted/40 border border-border/40 rounded px-2.5 py-1.5">
              <span className="font-semibold text-foreground/70">Help: </span>{f.helpText}
            </p>
          )}

          {/* Select options preview */}
          {selectOptCount > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Options ({selectOptCount})</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(f.selectOptions!).slice(0, 20).map(([k, v]) => (
                  <span key={k} className="text-[10px] bg-background border border-border px-2 py-0.5 rounded-full text-foreground/80">
                    {v || k}
                  </span>
                ))}
                {selectOptCount > 20 && <span className="text-[10px] text-muted-foreground">+{selectOptCount - 20} more</span>}
              </div>
            </div>
          )}

          {/* Visibility conditions */}
          {hasConditions && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                <GitBranch size={9} /> Visibility Conditions ({conditions.length})
              </p>
               <TooltipProvider>
                <div className="space-y-2">
                  {conditions.map((cond, ci) => {
                    if (!cond) return null;
                    const logicalOp = (cond?.logicalOperator || cond?.condition || (ci > 0 ? "AND" : "")) as string;
                    
                    let fieldNameRaw: any = cond?.fieldLabel ?? cond?.conditionFieldName ?? cond?.fieldName ?? cond?.field ?? cond?.id;
                    let fieldName = "?";
                    if (fieldNameRaw === null || fieldNameRaw === undefined) fieldName = "?";
                    else if (typeof fieldNameRaw === 'string' || typeof fieldNameRaw === 'number') fieldName = String(fieldNameRaw);
                    else if (typeof fieldNameRaw === 'object') fieldName = String((fieldNameRaw as any).displayName || (fieldNameRaw as any).label || (fieldNameRaw as any).id || (fieldNameRaw as any).name || JSON.stringify(fieldNameRaw));

                    const rawFieldIdStr = String(cond?.conditionFieldId ?? cond?.fieldId ?? (typeof cond?.field === 'object' ? (cond?.field as any)?.id : "") ?? "");
                    // Strip Leah's 'F600' alpha prefix: F600371 → 371, but keep plain numeric IDs intact
                    // Pattern: starts with optional letter(s) followed by zeros, then the real digits
                    let fieldId = rawFieldIdStr;
                    if (/^[A-Za-z]+0*\d+$/.test(rawFieldIdStr)) {
                      // Has alpha prefix — extract just the trailing digits
                      const m = rawFieldIdStr.match(/(\d+)$/);
                      if (m) fieldId = m[1];
                    }

                    const operatorRaw = String(cond?.operator ?? cond?.conditionType ?? "").trim();
                    const operatorStr = operatorRaw.toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
                    
                    const NO_VAL_OPS = ['ISNOTNULL', 'ISNULL', 'IS NOT NULL', 'IS NULL', 'IS EMPTY', 'IS NOT EMPTY', 'IS_NOT_NULL', 'IS_NULL', 'EXISTS', 'NOT EXISTS', 'NOT_NULL', 'NULL'];
                    const operatorNeedsNoValue = NO_VAL_OPS.some(op => operatorStr.replace(/\s/g,'').includes(op.replace(/\s/g,'')));

                    function extractVal(v: any): string {
                      if (v === null || v === undefined) return "";
                      if (Array.isArray(v)) {
                        const strs = v.map((x: any) => {
                          if (x === null || x === undefined || x === "") return null;
                          if (typeof x === 'object') return String((x as any).label ?? (x as any).displayValue ?? (x as any).name ?? (x as any).id ?? (x as any).value ?? JSON.stringify(x));
                          return String(x);
                        }).filter(Boolean) as string[];
                        return strs.join(', ');
                      }
                      if (typeof v === 'object') return String((v as any).label ?? (v as any).displayValue ?? (v as any).name ?? (v as any).id ?? (v as any).value ?? JSON.stringify(v));
                      return String(v);
                    }

                    let valStr = "";
                    if (!operatorNeedsNoValue) {
                      const candidates = [cond?.valueDisplay, cond?.displayValue, cond?.conditionValue, cond?.value, cond?.val, (cond as any)?.values];
                      for (const c of candidates) {
                        const ex = extractVal(c);
                        if (ex.trim().length > 0) { valStr = ex; break; }
                      }
                    }

                    // Guaranteed unique key: use array index + fieldId + operator + value snippet
                    const condKey = `cond-${ci}-${rawFieldIdStr}-${operatorRaw}-${valStr.slice(0,10)}`;
                    const opColor = operatorStr.includes('NOT') ? 'text-red-300 bg-red-500/10 border-red-500/20' :
                      operatorStr.includes('NULL') ? 'text-sky-300 bg-sky-500/10 border-sky-500/20' :
                      'text-amber-300 bg-amber-500/10 border-amber-500/20';

                    return (
                      <Tooltip key={condKey} delayDuration={200}>
                        <TooltipTrigger asChild>
                          <div className="bg-background/40 hover:bg-violet-500/10 border border-violet-500/20 hover:border-violet-500/40 rounded-lg px-3 py-2.5 text-[11px] font-mono transition-all cursor-help group/cond">
                            <div className="flex items-center gap-2 flex-wrap">
                              {ci > 0 && (
                                <span className="text-violet-300 font-black text-[9px] uppercase tracking-widest bg-violet-500/20 border border-violet-500/30 px-1.5 py-0.5 rounded shrink-0">
                                  {logicalOp || "AND"}
                                </span>
                              )}
                              <span className="text-muted-foreground/60 shrink-0 text-[10px]">IF</span>
                              <span className="text-violet-200 font-bold px-2 py-0.5 bg-violet-500/10 rounded border border-violet-500/25 max-w-[280px] truncate" title={fieldName}>
                                {fieldName}
                              </span>
                              {fieldId && fieldId !== "0" && (
                                <span className="text-muted-foreground/30 text-[9px] font-mono shrink-0" title={`Leah internal ID: ${rawFieldIdStr}`}>#{fieldId}</span>
                              )}
                              <span className={`font-bold px-2 py-0.5 rounded text-[10px] shrink-0 border ${opColor}`}>{operatorStr || "="}</span>
                              {!operatorNeedsNoValue && (
                                <span className={`font-semibold px-2 py-0.5 rounded border text-[11px] transition-colors ${
                                  valStr
                                    ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
                                    : 'text-red-400/50 bg-red-500/5 border-dashed border-red-500/20 text-[9px] italic'
                                }`}>
                                  {valStr ? `"${valStr}"` : "⚠ value not in API response — hover to inspect raw JSON"}
                                </span>
                              )}
                              {operatorNeedsNoValue && (
                                <span className="text-sky-500/40 text-[9px] italic shrink-0">— null check, no value required</span>
                              )}
                            </div>
                            {(cond as any)?.action && (
                              <div className="mt-2 text-[10px] text-muted-foreground/50 border-t border-white/5 pt-1.5 flex items-center gap-1.5">
                                <span className="text-white/30 font-bold tracking-widest text-[8px]">ACTION</span>
                                <span className="bg-white/5 border border-white/10 px-1.5 py-0.5 rounded text-white/60">{(cond as any).action}</span>
                              </div>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={12} className="w-[360px] bg-[#0a0a10] border-white/10 p-0 overflow-hidden shadow-2xl rounded-xl">
                          <div className="bg-violet-500/10 px-3 py-2 border-b border-white/10 flex items-center justify-between">
                            <p className="text-[10px] font-black text-violet-300 uppercase tracking-widest">Raw Leah Logic Schema</p>
                            <span className="text-[9px] text-muted-foreground/40">hover to inspect • copy with devtools</span>
                          </div>
                          <div className="p-3 text-[10px] font-mono text-emerald-400/80 whitespace-pre-wrap break-all max-h-[340px] overflow-auto leading-relaxed">
                            {JSON.stringify(cond, null, 2)}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </TooltipProvider>
              <p className="text-[9px] text-muted-foreground/40 mt-1.5">
                This field shows/hides based on the conditions above. Edit via the Leah CLM UI to modify conditions.
              </p>
            </div>
          )}

          {!hasConditions && (
            <p className="text-[10px] text-muted-foreground/40 italic">No visibility conditions — this field always shows.</p>
          )}
        </div>
      )}
    </div>
  );
}
