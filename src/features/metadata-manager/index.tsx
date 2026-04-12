import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Plus, Copy, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Search, X, Trash2,
  Edit2, Download, RefreshCw, Star, Eye, EyeOff, Loader2, GitBranch, List, Network, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  const [tab, setTab] = useState<"metadata" | "intake" | "tree">("metadata");
  const [selAppTypeId, setSelAppTypeId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [metaTypeFilter, setMetaTypeFilter] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [isGlobalMode, setIsGlobalMode] = useState(false);

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

  const fieldQueryKey = QK.fieldDefs(tenant, isGlobalMode ? "global" : (selAppTypeId ?? undefined));

  const { data: fieldData, isLoading, error, refetch } = useQuery({
    queryKey: fieldQueryKey,
    queryFn: () => listFieldDefinitions(clients!.newCloud, tenant, {
      applicationTypeId: isGlobalMode ? undefined : (selAppTypeId ?? undefined),
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

  // ── Influence Map (Impact Analysis) ──────────────────────────────────────
  
  const influenceMap = useMemo(() => {
    const map: Record<number, number> = {};
    const processCond = (c: any) => {
      const fid = parseInt(c?.conditionFieldId ?? c?.fieldId ?? (typeof c?.field === 'object' ? (c?.field as any)?.id : "") ?? "0", 10);
      if (fid && !isNaN(fid)) map[fid] = (map[fid] || 0) + 1;
    };

    intakeGroups.forEach(g => {
      g.sections?.forEach(s => {
        s.fields?.forEach(f => {
          let rules: any[] = [];
          if (Array.isArray(f.visibilityConditions)) rules = f.visibilityConditions;
          else if ((f as any).visibilityConditionObject?.rules) rules = (f as any).visibilityConditionObject.rules;
          rules.filter(Boolean).forEach(processCond);
        });
      });
    });
    return map;
  }, [intakeGroups]);

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
        "Domain": f.metadataType,
        "Logic Influence": influenceMap[f.fieldId] || 0,
        "Active": f.isActive ? "Yes" : "No",
        "Required": (f.isMandatoryField ?? f.isRequired) ? "Yes" : "No",
        "Visible": f.isVisible !== false ? "Yes" : "No",
        "Options Count": f.options?.length ?? 0,
        "Options": (f.options ?? []).map((o) => o.fieldOptionValue).join(", "),
        "Help Text": f.helpText ?? "",
        "Comments": f.comments ?? "",
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
            <Button
              variant={isGlobalMode ? "secondary" : "outline"}
              size="sm"
              className={cn("gap-1.5 transition-all", isGlobalMode && "bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.1)]")}
              onClick={() => setIsGlobalMode(!isGlobalMode)}
            >
              <Network size={13} className={cn(isGlobalMode && "animate-pulse")} />
              {isGlobalMode ? "Global Mode: ON" : "Turn Global Mode ON"}
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()}>
              <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} /> Refresh
            </Button>
            {tab === "metadata" && (
              <>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={exportToExcel} disabled={fields.length === 0}>
                  <Download size={13} /> Export
                </Button>
                <Button size="sm" className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20" onClick={openCreate}>
                  <Plus size={13} /> New Field
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Tab switcher */}
      <div className="flex items-center gap-2 bg-white/[0.02] border border-white/[0.05] p-1 rounded-2xl w-fit">
        <TabBtn active={tab === "metadata"} onClick={() => setTab("metadata")} icon={<List size={13} />}>
          Metadata
        </TabBtn>
        <TabBtn active={tab === "intake"} onClick={() => setTab("intake")} icon={<GitBranch size={13} />}>
          Intake Flow
          {tab === "intake" && !selAppTypeId && (
            <span className="ml-1.5 text-[9px] text-amber-400 opacity-80">(select app type)</span>
          )}
        </TabBtn>
        <TabBtn active={tab === "tree"} onClick={() => setTab("tree")} icon={<Network size={13} />}>
          Field Schema
          {tab === "tree" && !selAppTypeId && (
            <span className="ml-1.5 text-[9px] text-amber-400 opacity-80">(select app type)</span>
          )}
        </TabBtn>
      </div>

      {/* Shared filters dashboard */}
      <div className="p-4 bg-white/[0.01] border border-white/[0.05] rounded-2xl flex flex-wrap gap-4 items-center backdrop-blur-3xl">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-widest font-black text-muted-foreground/40 ml-1">Application Context</label>
          <select
            value={selAppTypeId ?? ""}
            disabled={isGlobalMode}
            onChange={(e) => { setSelAppTypeId(e.target.value ? Number(e.target.value) : null); }}
            className={cn(
              "h-10 text-sm bg-white/5 border border-white/10 rounded-xl px-4 focus:outline-none focus:ring-1 focus:ring-primary/40 min-w-[240px] transition-all",
              isGlobalMode && "opacity-40 cursor-not-allowed border-dashed"
            )}
          >
            <option value="" className="bg-neutral-900">{tab === "intake" ? "— Select type —" : "All application types"}</option>
            {(appTypesRaw ?? []).map((at: any) => (
              <option key={at.applicationTypeId} value={at.applicationTypeId} className="bg-neutral-900">{at.applicationTypeName}</option>
            ))}
          </select>
        </div>

        {tab === "metadata" && (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-widest font-black text-muted-foreground/40 ml-1">Metadata Domain</label>
              <select
                value={metaTypeFilter}
                onChange={(e) => setMetaTypeFilter(e.target.value)}
                className="h-10 text-sm bg-white/5 border border-white/10 rounded-xl px-4 focus:outline-none focus:ring-1 focus:ring-primary/40 min-w-[180px] transition-all"
              >
                <option value="all" className="bg-neutral-900">All domains</option>
                {METADATA_TYPES.map((mt) => (
                  <option key={mt.id} value={mt.id} className="bg-neutral-900">{mt.name}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5 flex-1 min-w-[240px]">
              <label className="text-[10px] uppercase tracking-widest font-black text-muted-foreground/40 ml-1 flex items-center gap-1.5">
                Active Search
                {isGlobalMode && <span className="text-[9px] text-amber-500 font-bold bg-amber-500/10 px-1.5 rounded animate-pulse">Global</span>}
              </label>
              <div className="relative group">
                <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                <Input
                  placeholder={isGlobalMode ? "Searching cross-AppType metadata..." : "Search by name, Internal key, or ID…"}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-10 pl-11 pr-10 text-sm bg-white/5 border border-white/10 rounded-xl focus:ring-primary/40 transition-all hover:bg-white/[0.08]"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 transition-colors">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {showMissingOnly && (
              <button
                onClick={() => setShowMissingOnly(false)}
                className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-red-100 bg-red-600/80 border border-red-500/30 px-4 h-10 rounded-xl hover:bg-red-500 transition-all shadow-lg shadow-red-900/20 mt-5"
              >
                <AlertTriangle size={12} className="animate-bounce" /> Missing options only
              </button>
            )}
          </>
        )}
      </div>

      {/* ── METADATA TAB ── */}
      {tab === "metadata" && (
        <>
          {/* Premium Dashboard Stats */}
          {!isLoading && allFields.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <StatTile 
                label="System Capacity" 
                value={stats.total} 
                subtext="Total Fields"
                icon={<Layers size={14} />}
              />
              <StatTile 
                label="Health Status" 
                value={stats.active} 
                subtext="Active in Leah"
                accent="green" 
                onClick={() => setActiveFilter(activeFilter === "active" ? "all" : "active")} 
                active={activeFilter === "active"} 
                icon={<CheckCircle2 size={14} />}
              />
              <StatTile 
                label="Dormant Fields" 
                value={stats.inactive} 
                subtext="Configuration Only"
                accent={stats.inactive > 0 ? "amber" : "default"} 
                onClick={() => setActiveFilter(activeFilter === "inactive" ? "all" : "inactive")} 
                active={activeFilter === "inactive"} 
                icon={<EyeOff size={14} />}
              />
              <StatTile 
                label="Interactive Metadata" 
                value={stats.dropdownLike} 
                subtext="Lists & Radios"
                accent="blue" 
                onClick={() => setTypeFilter(typeFilter !== "all" ? "all" : "dropdown")} 
                active={false} 
                icon={<List size={14} />}
              />
              <StatTile
                label="Configuration Gaps"
                value={stats.missingOptions}
                subtext="Zero-option Dropdowns"
                accent={stats.missingOptions > 0 ? "red" : "green"}
                icon={stats.missingOptions > 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
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
                  influenceCount={influenceMap[f.fieldId] || 0}
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

      {/* ── FIELD TREE TAB ── */}
      {tab === "tree" && (
        <FieldTreePanel
          fields={allFields}
          isLoading={isLoading}
          isGlobalMode={isGlobalMode}
          appTypeName={(appTypesRaw ?? []).find((at: any) => at.applicationTypeId === selAppTypeId)?.applicationTypeName}
          hasAppType={!!selAppTypeId || isGlobalMode}
        />
      )}

      {/* Side panel — fixed overlay so it doesn't affect layout */}
      {panel !== "none" && (
        <div className="fixed inset-y-0 right-0 z-40 w-full sm:w-[440px] border-l border-border bg-background/95 backdrop-blur-sm flex flex-col shadow-2xl">
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
  influenceCount: number;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddOption: (value: string) => void;
  onDeleteOption: (optionId: number) => void;
  addingOption: boolean;
  deletingOption: boolean;
}

function FieldRow({ field: f, influenceCount, expanded, onToggle, onEdit, onDelete, onAddOption, onDeleteOption, addingOption, deletingOption }: FieldRowProps) {
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
    <div className={cn(
      "transition-all duration-300 relative overflow-hidden mb-1 mx-2 rounded-2xl border border-white/[0.05]",
      expanded ? "bg-white/[0.04] shadow-2xl ring-1 ring-primary/20" : "bg-white/[0.02] hover:bg-white/[0.05]",
      isMissing && "ring-1 ring-red-500/20 bg-red-500/[0.02]"
    )}>
      {/* ── Visual Backdrop for highlight ── */}
      {influenceCount > 0 && (
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-3xl -translate-y-16 translate-x-16 pointer-events-none" />
      )}

      {/* ── Main row content ── */}
      <div
        className="grid items-center gap-4 px-6 py-4 cursor-pointer select-none"
        style={{ gridTemplateColumns: "20px 1fr auto auto auto 120px" }}
        onClick={onToggle}
      >
        {/* State Icon */}
        <div className="flex items-center justify-center">
          {expanded ? (
            <ChevronDown size={14} className="text-primary animate-pulse" />
          ) : (
            <ChevronRight size={14} className="text-muted-foreground/30" />
          )}
        </div>

        {/* Name + API + ID */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={cn("text-[14px] font-bold tracking-tight", !f.isActive && "opacity-40")}>
               {f.fieldDisplayName || f.fieldName}
            </span>
            {influenceCount > 0 && (
              <span className="text-[9px] font-black bg-primary/20 text-primary border border-primary/30 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                <GitBranch size={8} /> Logic Driver ({influenceCount})
              </span>
            )}
            {isMissing && (
              <span className="text-[9px] font-black bg-red-500/10 text-red-100 border border-red-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                <AlertTriangle size={8} className="animate-pulse" /> Empty Control
              </span>
            )}
            <span className="text-[9px] font-mono text-muted-foreground/20 ml-auto">#{f.fieldId}</span>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-mono text-muted-foreground/40 lowercase max-w-[180px] truncate">{f.fieldName}</p>
            {f.applicationTypeName && (
              <span className="text-[9px] font-bold text-muted-foreground/30 uppercase tracking-widest">• {f.applicationTypeName}</span>
            )}
          </div>
          {/* Options Preview for selection-type fields */}
          {needsOptions && optCount > 0 && !expanded && (
            <div className="mt-1.5 flex flex-wrap gap-1 items-center">
              <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/20 mr-1 italic">Preview:</span>
              {(f.options ?? []).slice(0, 50).map((o, idx) => (
                <span key={o.fieldOptionId} className="text-[9px] text-muted-foreground/40 bg-white/[0.03] px-1.5 py-0.5 rounded-md border border-white/5">
                  {o.fieldOptionValue}
                </span>
              ))}
              {optCount > 50 && <span className="text-[9px] text-muted-foreground/20">+{optCount - 50} more</span>}
            </div>
          )}
        </div>

        {/* Type & Capability */}
        <div className="flex flex-col items-end gap-1 px-4 border-l border-white/5 h-8 justify-center">
          <span className={cn("text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg border", tc.bg, tc.text, tc.border)}>
            {f.fieldType || "—"}
          </span>
          {needsOptions && (
             <span className={cn("text-[9px] font-bold tabular-nums", optCount === 0 ? "text-red-400" : "text-muted-foreground/40")}>
               {optCount} option{optCount !== 1 ? 's' : ''}
             </span>
          )}
        </div>

        {/* Status Indicator Grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-6 border-l border-white/5 h-8 items-center">
          <div className="flex items-center gap-2">
            <StatusDot active={f.isActive} color={f.isActive ? "green" : "gray"} label="" />
            <span className="text-[10px] uppercase font-black tracking-widest text-muted-foreground/30">Live</span>
          </div>
          <div className="flex items-center gap-2">
            <StatusDot active={!!isRequired} color={isRequired ? "amber" : "gray"} label="" />
            <span className="text-[10px] uppercase font-black tracking-widest text-muted-foreground/30">Req</span>
          </div>
        </div>

        {/* Actions Overlay */}
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          <button onClick={onEdit} className="p-2 hover:bg-white/10 rounded-xl transition-all text-muted-foreground hover:text-primary">
            <Edit2 size={14} />
          </button>
          <button onClick={onDelete} className="p-2 hover:bg-red-500/10 rounded-xl transition-all text-muted-foreground hover:text-red-400">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-6 pb-6 pt-4 border-t border-white/5 bg-white/[0.01] space-y-6 animate-in slide-in-from-top-2 duration-300">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            
            {/* Column 1: Core Configuration Details */}
            <div className="space-y-4">
              <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/60 border-b border-primary/20 pb-2 flex items-center gap-2">
                <Star size={12} /> System Flags
              </h5>
              <div className="grid grid-cols-1 gap-2">
                <InsightFlag active={f.isVisible !== false} label="Always Visible" desc="Field is accessible in the core metadata set." />
                <InsightFlag active={f.isVisibleOnRequestDetails !== false} label="Sidebar Summary" desc="Included in the request details side-panel." />
                <InsightFlag active={f.displayInRequestJourney === true} label="Timeline Stage" desc="Promoted to the visual request journey/tracker." />
                <InsightFlag active={f.displayInRequestDetails === true} label="Main Attributes" desc="Visible in the central information attributes tab." />
                {f.isForAllApplicationTypes && <InsightFlag active={true} label="Universal Field" desc="Available globally across all application types." />}
              </div>
            </div>

            {/* Column 2: Data & Metadata Context */}
            <div className="space-y-4">
              <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-400/60 border-b border-violet-400/20 pb-2 flex items-center gap-2">
                <Layers size={12} /> Architectural Context
              </h5>
              <div className="space-y-3 bg-white/[0.02] p-4 rounded-2xl border border-white/5">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-muted-foreground/60 font-bold uppercase tracking-wider text-[9px]">Internal Type ID</span>
                  <span className="font-mono text-violet-300">{f.fieldTypeId || "—"}</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-muted-foreground/60 font-bold uppercase tracking-wider text-[9px]">Metadata Domain</span>
                  <span className="font-mono text-emerald-300">{f.metadataType || "—"} (#{f.metadataType})</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-muted-foreground/60 font-bold uppercase tracking-wider text-[9px]">Field Category</span>
                  <span className="text-primary font-bold">{f.fieldGroup || "Uncategorized"}</span>
                </div>
                {influenceCount > 0 && (
                  <div className="pt-2 mt-2 border-t border-white/5">
                    <p className="text-[10px] text-amber-400/80 leading-relaxed font-medium">
                      This field determines the visibility of {influenceCount} other intake components.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Column 3: Documentation & Guidance */}
            <div className="space-y-4">
              <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400/60 border-b border-emerald-400/20 pb-2 flex items-center gap-2">
                <Edit2 size={12} /> Configurator Guidance
              </h5>
              <div className="space-y-3">
                <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/10">
                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400 mb-1">Help Text Prompt</p>
                  <p className="text-[11px] text-muted-foreground italic leading-relaxed">
                    {f.helpText || "No user-facing help text configured."}
                  </p>
                </div>
                <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Internal Comments</p>
                  <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
                    {f.comments || "No internal design notes recorded."}
                  </p>
                </div>
              </div>
            </div>

          </div>

          {/* Options Management Section */}
          {needsOptions && (
            <div className="mt-8 pt-6 border-t border-white/5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-xl">
                    <List size={14} className="text-primary" />
                  </div>
                  <div>
                    <h6 className="text-xs font-black uppercase tracking-widest">Metadata Values</h6>
                    <p className="text-[10px] text-muted-foreground/40">{optCount} available selection{optCount !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <button
                  className="px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-2"
                  onClick={() => { setShowAddOpt(true); setTimeout(() => inputRef.current?.focus(), 50); }}
                >
                  <Plus size={12} /> New Option
                </button>
              </div>

              {/* Option list */}
              {optCount > 0 ? (
                <div className="flex flex-wrap gap-2 p-4 bg-white/[0.02] rounded-3xl border border-white/5">
                  {f.options!.map((o) => (
                    <OptionChip
                      key={o.fieldOptionId}
                      option={o}
                      onDelete={() => onDeleteOption(o.fieldOptionId)}
                      deleting={deletingOption}
                    />
                  ))}
                </div>
              ) : !showAddOpt && (
                <div className="flex items-center justify-center p-8 bg-red-500/[0.02] border border-dashed border-red-500/20 rounded-3xl">
                  <div className="text-center">
                    <AlertTriangle size={24} className="text-red-400/40 mx-auto mb-2" />
                    <p className="text-xs text-red-400/60 font-medium">Critical Gap: No options defined for this selector.</p>
                  </div>
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
  label, value, subtext, accent = "default", icon, onClick, active,
}: {
  label: string; value: number; subtext?: string; accent?: "blue" | "red" | "green" | "amber" | "default";
  icon?: React.ReactNode; onClick?: () => void; active?: boolean;
}) {
  const themes = {
    blue:    "from-blue-500/10 to-transparent border-blue-500/20 text-blue-400 shadow-blue-500/5",
    red:     value > 0 ? "from-red-500/10 to-transparent border-red-500/20 text-red-100 shadow-red-500/5" : "from-emerald-500/10 to-transparent border-emerald-500/20 text-emerald-400 opacity-60",
    green:   "from-emerald-500/10 to-transparent border-emerald-500/20 text-emerald-400 shadow-emerald-500/5",
    amber:   value > 0 ? "from-amber-500/10 to-transparent border-amber-500/20 text-amber-400 shadow-amber-500/5" : "text-muted-foreground opacity-40",
    default: "from-white/5 to-transparent border-white/10 text-foreground",
  };

  const currentTheme = themes[accent];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "relative text-left bg-gradient-to-br border rounded-3xl p-4 transition-all duration-300 overflow-hidden group/tile",
        onClick ? "cursor-pointer hover:border-white/20 hover:-translate-y-1" : "cursor-default",
        active ? "border-primary/40 bg-primary/10 ring-1 ring-primary/20" : "border-white/5",
        currentTheme
      )}
    >
      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/tile:opacity-20 transition-all group-hover/tile:scale-125">
        {icon}
      </div>
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40 mb-3">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-black tabular-nums tracking-tighter">
          {value}
        </span>
        {subtext && <span className="text-[10px] font-bold text-muted-foreground/30 uppercase tracking-widest">{subtext}</span>}
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

function InsightFlag({ active, label, desc }: { active: boolean; label: string; desc: string }) {
  return (
    <div className={cn(
      "flex items-center gap-3 p-2.5 rounded-xl border transition-all",
      active 
        ? "bg-primary/10 border-primary/20 hover:bg-primary/20" 
        : "bg-white/[0.02] border-white/5 opacity-40 grayscale"
    )}>
      <div className={cn(
        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
        active ? "bg-primary/20 text-primary" : "bg-white/5 text-muted-foreground"
      )}>
        {active ? <Eye size={14} /> : <EyeOff size={14} />}
      </div>
      <div>
        <p className={cn("text-[11px] font-black uppercase tracking-wider", active ? "text-primary" : "text-muted-foreground")}>{label}</p>
        <p className="text-[10px] text-muted-foreground/60 leading-tight">{desc}</p>
      </div>
    </div>
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
    <div className="space-y-6">
      {groups.map((group, gi) => {
        const allFields: IntakeFormField[] = (group.sections ?? []).flatMap((s) => s.fields ?? []);

        return (
          <div key={gi} className="overflow-hidden bg-white/[0.02] border border-white/[0.05] rounded-3xl backdrop-blur-3xl shadow-2xl">
            {/* Group header */}
            <div className="bg-gradient-to-r from-primary/10 to-transparent px-6 py-5 border-b border-white/[0.05] flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 bg-primary/20 rounded-lg">
                    <Layers size={14} className="text-primary" />
                  </div>
                  <h4 className="text-sm font-black uppercase tracking-[0.2em] text-foreground">
                    {(group as any).groupName || (group as any).name || `Group ${gi + 1}`}
                  </h4>
                </div>
                {(group as any).groupType && (
                  <span className="text-[10px] text-muted-foreground/40 font-mono tracking-widest uppercase">{(group as any).groupType}</span>
                )}
              </div>
              <div className="text-right">
                <span className="text-2xl font-black text-white/10 tabular-nums leading-none block">{allFields.length}</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/30">Fields in Group</span>
              </div>
            </div>

            {/* Section labels */}
            <div className="p-2 space-y-2">
              {(group.sections ?? []).map((section, si) => (
                <div key={si} className="space-y-1">
                  {section.fields && section.fields.length > 0 && (
                    <div className="px-4 py-2 flex items-center gap-3">
                      <div className="h-px flex-1 bg-white/[0.05]" />
                      <span className="text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.3em] whitespace-nowrap">
                        {(section as any).sectionName || (section as any).name || `Section ${si + 1}`}
                      </span>
                      <div className="h-px flex-1 bg-white/[0.05]" />
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-1">
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
               <div className="space-y-2">
                {conditions.map((cond, ci) => {
                  if (!cond) return null;
                  const rawFieldIdStr = String(cond?.conditionFieldId ?? cond?.fieldId ?? (typeof cond?.field === 'object' ? (cond?.field as any)?.id : "") ?? "");
                  const operatorRaw = String(cond?.operator ?? cond?.conditionType ?? "").trim();
                  let valStr2 = "";
                  const candidates2: any[] = [cond?.valueDisplay, cond?.displayValue, cond?.conditionValue, cond?.value, cond?.val];
                  for (const c of candidates2) {
                    if (c === null || c === undefined) continue;
                    const ex = Array.isArray(c) ? c.filter(Boolean).map((x: any) => typeof x === 'object' ? String((x as any).label ?? (x as any).name ?? JSON.stringify(x)) : String(x)).join(', ') : String(c);
                    if (ex.trim()) { valStr2 = ex; break; }
                  }
                  const condKey = `cond-${ci}-${rawFieldIdStr}-${operatorRaw}-${valStr2.slice(0,8)}`;
                  return <ConditionCard key={condKey} cond={cond} ci={ci} />;
                })}
              </div>
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

// ─── Condition Card ───────────────────────────────────────────────────────────

function ConditionCard({ cond, ci }: { cond: any; ci: number }) {
  const [showRaw, setShowRaw] = useState(false);

  const logicalOp = String(cond?.logicalOperator || cond?.condition || (ci > 0 ? "AND" : ""));

  let fieldNameRaw: any = cond?.fieldLabel ?? cond?.conditionFieldName ?? cond?.fieldName ?? cond?.field ?? cond?.id;
  let fieldName = "?";
  if (fieldNameRaw === null || fieldNameRaw === undefined) fieldName = "?";
  else if (typeof fieldNameRaw === 'string' || typeof fieldNameRaw === 'number') fieldName = String(fieldNameRaw);
  else if (typeof fieldNameRaw === 'object') fieldName = String((fieldNameRaw as any).displayName || (fieldNameRaw as any).label || (fieldNameRaw as any).id || (fieldNameRaw as any).name || JSON.stringify(fieldNameRaw));

  const rawFieldIdStr = String(cond?.conditionFieldId ?? cond?.fieldId ?? (typeof cond?.field === 'object' ? (cond?.field as any)?.id : "") ?? "");
  let fieldId = rawFieldIdStr;
  if (/^[A-Za-z]+0*\d+$/.test(rawFieldIdStr)) {
    const m = rawFieldIdStr.match(/(\d+)$/);
    if (m) fieldId = m[1];
  }

  const operatorRaw = String(cond?.operator ?? cond?.conditionType ?? "").trim();
  const operatorStr = operatorRaw.toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
  const NO_VAL_OPS = ['ISNOTNULL','ISNULL','IS NOT NULL','IS NULL','IS EMPTY','IS NOT EMPTY','IS_NOT_NULL','IS_NULL','EXISTS','NOT EXISTS','NOT_NULL','NULL'];
  const operatorNeedsNoValue = NO_VAL_OPS.some(op => operatorStr.replace(/\s/g,'').includes(op.replace(/\s/g,'')));

  let valStr = "";
  if (!operatorNeedsNoValue) {
    const candidates: any[] = [cond?.valueDisplay, cond?.displayValue, cond?.conditionValue, cond?.value, cond?.val, (cond as any)?.values];
    for (const c of candidates) {
      if (c === null || c === undefined) continue;
      let ex = "";
      if (Array.isArray(c)) {
        ex = c.filter(Boolean).map((x: any) => typeof x === 'object' ? String((x as any).label ?? (x as any).displayValue ?? (x as any).name ?? (x as any).id ?? JSON.stringify(x)) : String(x)).join(', ');
      } else if (typeof c === 'object') {
        ex = String((c as any).label ?? (c as any).displayValue ?? (c as any).name ?? (c as any).id ?? (c as any).value ?? JSON.stringify(c));
      } else {
        ex = String(c);
      }
      if (ex.trim()) { valStr = ex; break; }
    }
  }

  const opColor = operatorStr.includes('NOT') ? 'text-red-300 bg-red-500/10 border-red-500/20' :
    operatorStr.includes('NULL') ? 'text-sky-300 bg-sky-500/10 border-sky-500/20' :
    'text-amber-300 bg-amber-500/10 border-amber-500/20';

  return (
    <div className="rounded-lg border border-violet-500/20 overflow-hidden">
      {/* Main condition row */}
      <div className="bg-background/40 hover:bg-violet-500/5 px-3 py-2.5 text-[11px] font-mono transition-all">
        <div className="flex items-center gap-2 flex-wrap">
          {ci > 0 && (
            <span className="text-violet-300 font-black text-[9px] uppercase tracking-widest bg-violet-500/20 border border-violet-500/30 px-1.5 py-0.5 rounded shrink-0">
              {logicalOp || "AND"}
            </span>
          )}
          <span className="text-muted-foreground/60 shrink-0 text-[10px]">IF</span>
          <span className="text-violet-200 font-bold px-2 py-0.5 bg-violet-500/10 rounded border border-violet-500/25 max-w-[260px] truncate" title={fieldName}>
            {fieldName}
          </span>
          {fieldId && fieldId !== "0" && (
            <span className="text-muted-foreground/30 text-[9px] font-mono shrink-0">#{fieldId}</span>
          )}
          <span className={`font-bold px-2 py-0.5 rounded text-[10px] shrink-0 border ${opColor}`}>{operatorStr || "="}</span>
          {!operatorNeedsNoValue && (
            <span className={cn("font-semibold px-2 py-0.5 rounded border text-[11px] transition-colors", valStr ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25' : 'text-muted-foreground/40 border-dashed border-muted text-[9px] italic')}>
              {valStr ? `"${valStr}"` : "value unavailable"}
            </span>
          )}
          {operatorNeedsNoValue && (
            <span className="text-sky-500/40 text-[9px] italic shrink-0">— null check</span>
          )}
          {/* Raw JSON toggle */}
          <button
            onClick={() => setShowRaw(p => !p)}
            className={cn("ml-auto shrink-0 text-[9px] px-2 py-0.5 rounded border transition-colors", showRaw ? "text-violet-400 bg-violet-500/20 border-violet-500/40" : "text-muted-foreground/40 border-border/40 hover:text-muted-foreground hover:border-border")}
          >
            {showRaw ? "▲ schema" : "▼ schema"}
          </button>
        </div>
        {(cond as any)?.action && (
          <div className="mt-1.5 text-[10px] text-muted-foreground/50 flex items-center gap-1.5">
            <span className="text-white/30 font-bold tracking-widest text-[8px]">ACTION</span>
            <span className="bg-white/5 border border-white/10 px-1.5 py-0.5 rounded text-white/60">{(cond as any).action}</span>
          </div>
        )}
      </div>
      {/* Inline raw JSON panel */}
      {showRaw && (
        <div className="border-t border-violet-500/20">
          <div className="bg-violet-500/5 px-3 py-1.5 border-b border-violet-500/10 flex items-center justify-between">
            <span className="text-[9px] font-black text-violet-400 uppercase tracking-widest">Raw Leah Logic Schema</span>
            <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(cond, null, 2)); toast.success('Copied JSON'); }} className="text-[9px] text-muted-foreground/40 hover:text-violet-400 transition-colors">
              copy
            </button>
          </div>
          <pre className="p-3 text-[10px] font-mono text-emerald-400/80 whitespace-pre-wrap break-all max-h-[280px] overflow-auto leading-relaxed bg-[#080812]">
            {JSON.stringify(cond, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Field Tree Panel ─────────────────────────────────────────────────────────

function FieldTreePanel({ fields, isLoading, isGlobalMode, appTypeName, hasAppType }: {
  fields: FieldDefinition[];
  isLoading: boolean;
  isGlobalMode: boolean;
  appTypeName?: string;
  hasAppType: boolean;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [treeSearch, setTreeSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const filtered = useMemo(() => {
    const q = treeSearch.toLowerCase();
    return fields.filter(f => {
      if (!showInactive && !f.isActive) return false;
      if (q && !f.fieldDisplayName?.toLowerCase().includes(q) && !f.fieldName?.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [fields, showInactive, treeSearch]);

  const groupedFields = useMemo(() => {
    const groups = new Map<string, FieldDefinition[]>();
    for (const f of filtered) {
      const groupKey = f.fieldGroup || f.applicationTypeName || "General";
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push(f);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  function toggleGroup(g: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });
  }

  function expandAll() { setExpandedGroups(new Set(groupedFields.map(([k]) => k))); }
  function collapseAll() { setExpandedGroups(new Set()); }

  const activeCount = fields.filter(f => f.isActive).length;
  const inactiveCount = fields.length - activeCount;

  if (!hasAppType) return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
      <Network size={40} className="text-muted-foreground/20" />
      <div>
        <p className="text-sm font-medium text-muted-foreground">Select an Application Type</p>
        <p className="text-xs text-muted-foreground/50 mt-1">Choose an app type above to visualize its complete field schema</p>
      </div>
    </div>
  );

  if (isLoading) return <div className="flex justify-center py-20"><Spinner size={28} /></div>;

  return (
    <div className="space-y-6">
      {/* Header banner */}
      <div className="flex flex-wrap items-center justify-between gap-6 p-6 bg-white/[0.02] border border-white/[0.05] rounded-[2rem] backdrop-blur-3xl shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 rounded-2xl ring-1 ring-primary/20">
            <Network size={20} className="text-primary" />
          </div>
          <div>
            <h4 className="text-lg font-black tracking-tight text-white mb-0.5">{isGlobalMode ? "Global Metadata Map" : (appTypeName ?? "Schema Intelligence")}</h4>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">
              <span className="text-emerald-400">{activeCount} Node{activeCount !== 1 ? 's' : ''} live</span>
              <span className="mx-2 opacity-20">|</span>
              <span className="text-violet-400">{groupedFields.length} Logical Groups</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
          <div className="relative group min-w-[200px]">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <input
              value={treeSearch}
              onChange={e => setTreeSearch(e.target.value)}
              placeholder="Search schema..."
              className="h-10 pl-10 pr-4 text-xs bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary/40 w-full transition-all"
            />
          </div>
          <button
            onClick={() => setShowInactive(p => !p)}
            className={cn(
              "h-10 px-4 text-[10px] font-black uppercase tracking-widest rounded-xl border transition-all",
              showInactive 
                ? "bg-amber-500/20 border-amber-500/40 text-amber-400" 
                : "bg-white/5 border-white/10 text-muted-foreground hover:text-white"
            )}
          >
            {showInactive ? "Viewing All" : "Hide Dormant"}
          </button>
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 ml-2">
            <button onClick={expandAll} className="h-8 px-3 text-[10px] font-black uppercase tracking-widest hover:text-primary transition-colors">Expand</button>
            <div className="w-px h-4 bg-white/10 my-auto" />
            <button onClick={collapseAll} className="h-8 px-3 text-[10px] font-black uppercase tracking-widest hover:text-primary transition-colors">Collapse</button>
          </div>
        </div>
      </div>

      {/* Tree Visualization */}
      <div className="space-y-3">
        {groupedFields.length === 0 && (
          <div className="py-24 text-center bg-white/[0.01] border border-dashed border-white/5 rounded-[2rem]">
            <Search size={32} className="mx-auto mb-4 opacity-10" />
            <p className="text-sm font-medium text-muted-foreground/40">Zero matches found in schema</p>
          </div>
        )}
        {groupedFields.map(([group, groupFields]) => {
          const isOpen = expandedGroups.has(group);
          const activeInGroup = groupFields.filter(f => f.isActive).length;
          const hasConditioned = groupFields.filter(f => {
            const vc = (f as any).visibilityConditions;
            return Array.isArray(vc) ? vc.length > 0 : !!vc;
          }).length;

          return (
            <div key={group} className={cn(
              "group/tree rounded-2xl border transition-all duration-300",
              isOpen ? "bg-white/[0.04] border-white/10 shadow-xl" : "bg-white/[0.01] border-white/5 hover:bg-white/[0.02]"
            )}>
              {/* Group header */}
              <button
                onClick={() => toggleGroup(group)}
                className="w-full flex items-center gap-4 px-6 py-4 text-left relative"
              >
                <div className={cn("transition-transform duration-300 text-muted-foreground/20 group-hover/tree:text-primary", isOpen && "rotate-90")}>
                  <ChevronRight size={16} />
                </div>
                <div className="p-2 bg-violet-500/10 rounded-xl group-hover/tree:scale-110 transition-transform">
                  <Layers size={14} className="text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-sm text-foreground block truncate">{group}</span>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/30">{groupFields.length} Components</span>
                    {hasConditioned > 0 && (
                      <span className="text-[9px] text-violet-400/60 font-black uppercase tracking-widest flex items-center gap-1">
                        <GitBranch size={8} /> {hasConditioned} Dynamic
                      </span>
                    )}
                  </div>
                </div>
                {!isOpen && (
                  <div className="flex -space-x-1.5 opacity-40">
                    {groupFields.slice(0, 3).map(f => (
                       <div key={f.fieldId} className="w-5 h-5 rounded-full border border-neutral-900 bg-neutral-800 flex items-center justify-center text-[7px] font-black">
                         {f.fieldType?.charAt(0).toUpperCase()}
                       </div>
                    ))}
                  </div>
                )}
              </button>

              {/* Field rows */}
              {isOpen && (
                <div className="divide-y divide-border/40">
                  {groupFields.map((f) => {
                    const tc = typeColor(f.fieldType);
                    const isRequired = f.isMandatoryField ?? f.isRequired;
                    const condCount = (() => {
                      const vc = (f as any).visibilityConditions;
                      if (Array.isArray(vc)) return vc.length;
                      return vc ? 1 : 0;
                    })();

                    return (
                      <div
                        key={f.fieldId}
                        className={cn(
                          "flex items-center gap-3 px-4 py-2.5 hover:bg-muted/10 transition-colors",
                          !f.isActive && "opacity-40",
                        )}
                      >
                        {/* Tree connector lines */}
                        <div className="flex items-center gap-0 text-border shrink-0 select-none">
                          <span className="w-3 border-l border-b border-border/30 h-5 mr-1.5" />
                        </div>

                        {/* Active dot */}
                        <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", f.isActive ? "bg-emerald-400" : "bg-muted-foreground/20")} />

                        {/* Field info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={cn("text-[13px] font-black text-foreground truncate max-w-[280px]", !f.isActive && "opacity-40")}>
                               {f.fieldDisplayName || f.fieldName}
                            </span>
                            {isRequired && (
                              <span className="text-[8px] font-black text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1 py-0.5 rounded shrink-0">REQ</span>
                            )}
                            {condCount > 0 && (
                              <span className="text-[8px] font-black text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1 py-0.5 rounded shrink-0 flex items-center gap-0.5">
                                <GitBranch size={7} />{condCount}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-[9px] font-mono text-muted-foreground/40 truncate">{f.fieldName}</p>
                            {f.applicationTypeName && isGlobalMode && (
                              <span className="text-[8px] font-black text-muted-foreground/20 uppercase tracking-[0.2em]">• {f.applicationTypeName}</span>
                            )}
                          </div>
                          
                          {/* Options preview for tree nodes */}
                          {isDropdownLike(f.fieldType) && f.options && f.options.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1 opacity-60">
                              {f.options.slice(0, 50).map(o => (
                                <span key={o.fieldOptionId} className="text-[8px] bg-white/5 px-1 rounded border border-white/5 text-muted-foreground/60">
                                  {o.fieldOptionValue}
                                </span>
                              ))}
                              {f.options.length > 50 && <span className="text-[8px] text-muted-foreground/30">+{f.options.length - 50}</span>}
                            </div>
                          )}
                        </div>

                        {/* Type chip */}
                        <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0 whitespace-nowrap", tc.bg, tc.text, tc.border)}>
                          {f.fieldType || "—"}
                        </span>

                        {/* ID + copy */}
                        <span className="text-[9px] font-mono text-muted-foreground/30 w-8 text-right shrink-0">#{f.fieldId}</span>
                        <button
                          onClick={() => { navigator.clipboard.writeText(String(f.fieldId)); toast.success(`Copied #${f.fieldId}`); }}
                          className="opacity-0 group-hover:opacity-100 hover:opacity-100 p-1 text-muted-foreground/40 hover:text-foreground rounded transition-all"
                        >
                          <Copy size={10} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
