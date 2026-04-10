import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FlaskConical, CheckCircle2, Trash2, Play, AlertCircle, Download,
  XCircle, Loader2, Plus, Edit2, X, Search, Clock,
  Copy, ExternalLink, CheckSquare, Square, AlertTriangle, RotateCcw, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Spinner } from "@/components/shared/PageHeader";
import { useApiClients } from "@/hooks/useApiClients";
import { useAuthStore } from "@/store/authStore";
import { QK, cn } from "@/lib/utils";
import { getIntakeFormFields, createContract, getContractDetail, updateContract, buildUpdatePayload, generateContractVersion } from "@/api/contractRequest";
import { getContractTemplates } from "@/api/applicationTypes";
import { getPreExecutionApprovals } from "@/api/approval";
import { listUsers } from "@/api/users";
import { listFieldDefinitions } from "@/api/metadata";
import { ContractEditDrawer } from "@/features/contract-edit/components/ContractEditDrawer";
import type { IntakeFormField, ContractDetail, FieldOption } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type FillMode = "mandatory" | "all" | "custom";
type StepStatus = "idle" | "running" | "pass" | "fail" | "warn";
type RunStatus = "idle" | "running" | "done" | "error";

interface TestStep {
  id: string;
  label: string;
  status: StepStatus;
  result?: string;
  durationMs?: number;
}

interface FlatField extends IntakeFormField {
  groupName: string;
  groupType: string;
  sectionName: string;
  isMandatory?: boolean; // From intake-form-field-groups API
}

interface TestRun {
  id: string;
  index: number;
  appTypeId: number;
  appTypeName: string;
  templateId?: number;
  templateName?: string;
  requestId?: number;
  status: RunStatus;
  steps: TestStep[];
  startedAt?: number;
  finishedAt?: number;
  fieldValues: Record<string, string>;
  selectedClientId?: number | null;
  selectedPartyId?: number | null;
  editOpen: boolean;
  error?: string;
  currentStage?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Strategy: skip only known select/file/ID types that need real values.
// Everything else falls through to a generic text value so required fields get filled.

function isMandatory(f: FlatField): boolean {
  if (f.isMandatory || f.isRequired) return true;
  const name = (f.displayName || f.fieldName || "").toLowerCase();
  // Broaden to catch common backend mandatory fields that might not be marked isMandatory in intake
  return name.includes("primaid") || 
         name.includes("primaryid") || 
         name.includes("legalentity") || 
         name.includes("legal entity") ||
         name.includes("counterparty") ||
         name.includes("organization") ||
         name.includes("businessunit") ||
         name.includes("country");
}

function dummyValue(field: FlatField, fallbackOpts?: Record<string, string> | null): string {
  const ft = (field.fieldType ?? "").toLowerCase().replace(/\s/g, "");

  // 1. Explicit options — use first key's label
  const opts = (field.selectOptions && Object.keys(field.selectOptions).length > 0)
    ? field.selectOptions
    : (fallbackOpts && Object.keys(fallbackOpts).length > 0 ? fallbackOpts : null);
  if (opts) {
    const v = opts[Object.keys(opts)[0]];
    return (v as string) || Object.keys(opts)[0];
  }
  if (field.values?.length) return field.values[0].label || field.values[0].value;

  // 2. Types that need real IDs / file handles
  if (ft.includes("lookup") || ft.includes("entity") || ft.includes("reference") ||
      ft.includes("user") || ft.includes("autocomplete") || ft.includes("guid") ||
      ft.includes("department")) return field.isRequired ? "1" : "";
      
  if (ft.includes("table") || ft.includes("file") || ft.includes("attachment") ||
      ft.includes("upload")) return "";

  // 3. Select-like types without loaded options — skip (arbitrary value rejected)
  if (ft.includes("dropdown") || ft.includes("radio") || ft.includes("checkbox") ||
      ft.includes("multiselect") || ft.includes("select") || ft.includes("picklist")) {
    return field.isRequired ? "Auto Test Value" : "";
  }

  // 4. Typed free-entry fields
  if (ft.includes("date")) return new Date().toISOString().split("T")[0];
  if (ft.includes("number") || ft.includes("integer") || ft.includes("decimal") ||
      ft.includes("numeric") || ft.includes("currency") || ft.includes("money") ||
      ft.includes("percentage") || ft.includes("percent")) return "42";
  if (ft.includes("email")) return "test.run@example.com";
  if (ft.includes("phone") || ft.includes("tel")) return "+1-555-000-0000";
  if (ft.includes("url") || ft.includes("link") || ft.includes("website")) return "https://example.com";

  // 5. Anything else (text, shorttext, multilinetext, textarea, string, etc.) → text
  return "Auto Test Value";
}

function buildInitialValues(
  fields: FlatField[], mode: FillMode, customSel: Set<string>,
  fallbackOptsMap?: Record<number, Record<string, string>>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const id = String(f.fieldId);
    const mandatory = isMandatory(f);
    
    // Check mode
    if (mode === "mandatory" && !mandatory) continue;
    if (mode === "custom" && !customSel.has(id)) continue;
    
    // Generate value
    let val = dummyValue(f, fallbackOptsMap?.[f.fieldId]);
    
    // Strict enforcement for required fields
    if (mandatory && (!val || !val.trim())) {
      const ft = (f.fieldType ?? "").toLowerCase();
      val = (ft.includes("lookup") || ft.includes("user") || ft.includes("entity") || ft.includes("reference") || ft.includes("autocomplete")) 
        ? "1" 
        : "Auto Test Value";
    }
    
    out[id] = val;
  }
  return out;
}

function extractApiError(e: any): string {
  const d = e?.response?.data;
  if (!d) return e?.message ?? "Unknown error";

  // Leah validation failure shape: { Errors: { FieldName: ["msg1","msg2"], ... } }
  const errors = d.Errors ?? d.errors;
  if (errors && typeof errors === "object") {
    const lines: string[] = [];
    for (const [key, val] of Object.entries(errors)) {
      const msgs = Array.isArray(val) ? val : [String(val)];
      for (const msg of msgs) {
        const s = String(msg).trim();
        if (!s) continue;
        // Prefix with field category for clarity
        if (key === "Clients" || key === "clients") {
          lines.push(`Client: ${s}`);
        } else if (key === "CustomFields" || key === "customFields") {
          lines.push(`Fields: ${s}`);
        } else if (/^\d+$/.test(key)) {
          // Numeric keys are extra validation messages (e.g. client business rules)
          lines.push(`Rule: ${s}`);
        } else {
          lines.push(`${key}: ${s}`);
        }
      }
    }
    if (lines.length > 0) return lines.join("\n");
  }

  return d.Detail ?? d.detail ?? d.message ?? d.Message ?? d.title ?? d.Title ?? JSON.stringify(d).slice(0, 300);
}

interface ClientDetail {
  clientId: number;
  roleId: number | null;
  addressDetailId: number | null;       // 0 = has address, no detail ID; null = no addresses
  contactNumberDetailId: number | null; // null = client has no contact numbers
  emailDetailId: number | null;         // null = client has no emails
  contactNameDetailId: number | null;   // null = client has no contact names
}

function buildPayload(
  run: TestRun, fields: FlatField[],
  userId: number, deptId: number, username: string,
  globalClientId: number | null, globalPartyId: number | null,
  metaOptsMap?: Record<number, Record<string, string>>,
  clientDetail?: ClientDetail | null
): any {
  const customFields: any[] = [];

  for (const [id, value] of Object.entries(run.fieldValues)) {
    if (!value || !String(value).trim()) continue;
    const fid = Number(id);
    const field = fields.find(f => f.fieldId === fid);
    if (!field) continue;

    const ft = (field.fieldType ?? "").toLowerCase().replace(/\s/g, "");
    const mandatory = isMandatory(field);

    // Skip system/standard group fields UNLESS they are mandatory
    if ((field.groupType === "Standard" || field.groupType === "System") && !mandatory) {
      continue;
    }

    // Skip complex entity reference fields since we cannot auto-generate valid foreign keys
    // UNLESS they are mandatory (in which case we send a dummy ID)
    if (ft.includes("table") || ft.includes("file") || ft.includes("attachment") ||
        ft.includes("upload") || ft.includes("lookup") || ft.includes("entity") ||
        ft.includes("reference") || ft.includes("user") || ft.includes("autocomplete") || 
        ft.includes("guid") || ft.includes("department")) {
      if (!mandatory) continue;
    }

    // For Select types, strictly enforce that the submitted value MUST be a known valid option.
    const isSelectType = ft.includes("dropdown") || ft.includes("radio") || ft.includes("checkbox") ||
      ft.includes("multiselect") || ft.includes("select") || ft.includes("picklist");
    
    let safeValue = String(value);

    if (isSelectType) {
      const intakeVals = field.selectOptions ? Object.values(field.selectOptions) : [];
      const metaVals = metaOptsMap?.[fid] ? Object.values(metaOptsMap[fid]) : [];
      const validVals = field.values?.map(v => v.label || v.value) ?? [];
      const allValid = [...intakeVals, ...metaVals, ...validVals].map(String);
      
      if (!allValid.includes(safeValue)) {
        if (!mandatory) {
          continue;
        } else if (allValid.length > 0) {
          safeValue = allValid[0]; // Auto-correct mandatory select to first valid option
        } else {
          continue;
        }
      }
    }

    if (field.groupType === "Custom") {
      customFields.push({ customFieldId: fid, customFieldValue: safeValue });
    }
  }

  const clientId = run.selectedClientId ?? globalClientId;
  const partyId = run.selectedPartyId ?? globalPartyId;

  const clientPayload: any = {
    clientId,
    isPrimary: true,
  };
  
  if (clientDetail) {
    if (clientDetail.roleId) clientPayload.roleId = clientDetail.roleId;
    // Priority: use valid detail IDs from the client profile
    if (clientDetail.addressDetailId) clientPayload.addressDetailId = clientDetail.addressDetailId;
    if (clientDetail.contactNumberDetailId) clientPayload.contactNumberDetailId = clientDetail.contactNumberDetailId;
    if (clientDetail.emailDetailId) clientPayload.emailDetailId = clientDetail.emailDetailId;
    if (clientDetail.contactNameDetailId) clientPayload.contactNameDetailId = clientDetail.contactNameDetailId;
  }

  return {
    id: run.requestId ?? 0,
    applicationTypeId: run.appTypeId,
    contractTemplateId: run.templateId ?? 0,
    requestTypeId: 1,
    recordId: 0,
    isUploadedContract: false,
    requestorUsername: username,
    description: `[BulkTest-${run.index}] Auto ${new Date().toLocaleString()}`,
    isConfidential: false,
    assignees: [{ userId, departmentId: deptId, isPrimary: true }],
    requesterUser: { UserId: userId, DepartmentId: deptId },
    requestorId: userId,
    requestorDpId: deptId,
    legalParties: partyId != null && partyId > 0 ? [{ legalPartyId: partyId, isPrimary: true }] : [],
    clients: clientId != null && clientId > 0 ? [clientPayload] : [],
    customFields,
    skipCustomFields: true,
    skipClientCustomFields: true,
  };
}

function exportCSV(runs: TestRun[]) {
  const rows: string[][] = [["Run", "REQ-ID", "Status", "Step", "Step Status", "Result", "Duration", "Started"]];
  runs.forEach(r => {
    r.steps.forEach(s => rows.push([
      String(r.index), String(r.requestId ?? ""), r.status,
      s.label, s.status, s.result ?? r.error ?? "",
      String(s.durationMs ?? ""),
      r.startedAt ? new Date(r.startedAt).toISOString() : "",
    ]));
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
    download: `bulk-test-${Date.now()}.csv`,
  });
  a.click();
  toast.success("CSV downloaded");
}

function buildSteps(): TestStep[] {
  return [
    { id: "create",    label: "Create / Update",    status: "idle" },
    { id: "generate",  label: "Document Gen",       status: "idle" },
    { id: "fetch",     label: "Fetch & Verify",      status: "idle" },
    { id: "approvals", label: "Approval Check",      status: "idle" },
    { id: "stage",     label: "Workflow Stage",       status: "idle" },
    { id: "fields",    label: "Metadata Audit",       status: "idle" },
  ];
}

// ─── Small UI Components ──────────────────────────────────────────────────────

function IntakeFieldInput({ field, value, onChange }: { field: FlatField; value: string; onChange: (v: string) => void }) {
  const ft = (field.fieldType ?? "").toLowerCase().replace(/\s/g, "");
  const cls = "w-full h-8 text-xs bg-background border border-border rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-ring transition-colors";

  if (field.selectOptions && Object.keys(field.selectOptions).length > 0) {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
        <option value="">— select —</option>
        {Object.entries(field.selectOptions).map(([k, v]) => <option key={k} value={(v as string) || k}>{(v as string) || k}</option>)}
      </select>
    );
  }
  if (field.values?.length) {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
        <option value="">— select —</option>
        {field.values.map(v => <option key={v.value} value={v.label || v.value}>{v.label || v.value}</option>)}
      </select>
    );
  }
  if (ft === "date") return <input type="date" value={value} onChange={e => onChange(e.target.value)} className={cls} />;
  if (ft === "number" || ft === "currency" || ft === "percentage") return <input type="number" value={value} onChange={e => onChange(e.target.value)} className={cls} />;
  if (ft === "multilinetext" || ft === "textarea") return <textarea value={value} onChange={e => onChange(e.target.value)} rows={2} className={cls + " h-auto py-1.5 resize-none"} />;
  return <input type="text" value={value} onChange={e => onChange(e.target.value)} className={cls} />;
}

function StepPill({ step }: { step: TestStep }) {
  const s = step.status;
  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-medium transition-all",
      s === "pass" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
      s === "fail" ? "bg-red-500/10 border-red-500/20 text-red-400" :
      s === "warn" ? "bg-amber-500/10 border-amber-500/20 text-amber-400" :
      s === "running" ? "bg-blue-500/10 border-blue-500/20 text-blue-400" :
      "bg-muted/30 border-border text-muted-foreground/50"
    )} title={step.result}>
      {s === "pass" ? <CheckCircle2 size={10} /> :
       s === "fail" ? <XCircle size={10} /> :
       s === "warn" ? <AlertTriangle size={10} /> :
       s === "running" ? <Loader2 size={10} className="animate-spin" /> :
       <Clock size={10} />}
      <span className="truncate max-w-[80px]">{step.label}</span>
      {step.durationMs && <span className="text-[9px] opacity-50">{step.durationMs}ms</span>}
    </div>
  );
}

// ─── Run Card ─────────────────────────────────────────────────────────────────

function RunCard({
  run, allFields, cloudInstance, liveClients, liveParties,
  onRun, onDelete, onToggleEdit,
  onFieldChange, onClientChange, onPartyChange, onSaveAndRerun, onViewContract, isRunningAll,
}: {
  run: TestRun;
  allFields: FlatField[];
  cloudInstance: string;
  liveClients: { id: number; name: string }[];
  liveParties: { id: number; name: string }[];
  onRun: () => void;
  onDelete: () => void;
  onToggleEdit: () => void;
  onFieldChange: (fieldId: string, value: string) => void;
  onClientChange: (id: number | null) => void;
  onPartyChange: (id: number | null) => void;
  onSaveAndRerun: () => void;
  onViewContract: () => void;
  isRunningAll: boolean;
}) {
  const { tenant } = useAuthStore();
  const isRun = run.status === "running";
  const isErr = run.status === "error";
  const isDone = run.status === "done";

  // Group fields by section for the edit form
  const groupedForEdit = useMemo(() => {
    const groups: Record<string, FlatField[]> = {};
    for (const f of allFields) {
      const key = `${f.groupName} > ${f.sectionName}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    }
    return groups;
  }, [allFields]);

  const fieldCount = Object.keys(run.fieldValues).length;
  const filledCount = Object.values(run.fieldValues).filter(Boolean).length;

  return (
    <div className={cn(
      "border rounded-xl bg-card overflow-hidden transition-all duration-200",
      isDone ? "border-emerald-500/30" :
      isErr ? "border-red-500/30" :
      isRun ? "border-blue-500/40 ring-1 ring-blue-500/20" :
      "border-border"
    )}>
      {/* ── Header ── */}
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
        {/* Status icon */}
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold",
          isDone ? "bg-emerald-500/10 text-emerald-500" :
          isErr ? "bg-red-500/10 text-red-500" :
          isRun ? "bg-blue-500/10 text-blue-500" :
          "bg-muted text-muted-foreground"
        )}>
          {isDone ? <CheckCircle2 size={16} /> : isErr ? <AlertCircle size={16} /> :
           isRun ? <Loader2 size={14} className="animate-spin" /> : run.index}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">Run #{run.index}</span>
            {run.requestId && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono bg-muted border border-border px-1.5 py-0.5 rounded">
                REQ-{run.requestId}
                <button
                  onClick={() => { navigator.clipboard.writeText(String(run.requestId)); toast.success("Copied"); }}
                  className="hover:text-foreground text-muted-foreground"
                ><Copy size={9} /></button>
                <a
                  href={`https://${cloudInstance}/${tenant ? (tenant.charAt(0).toUpperCase() + tenant.slice(1)) : "IntegreonPG"}/#/contract-snapshot/${run.requestId}`}
                  target="_blank" rel="noreferrer"
                  className="text-blue-400 hover:text-blue-300"
                ><ExternalLink size={9} /></a>
              </span>
            )}
            {run.currentStage && (
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider",
                run.currentStage.toLowerCase().includes("complete") ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" :
                "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
              )}>
                {run.currentStage}
              </span>
            )}
            {isErr && <span className="text-[10px] text-red-400 font-medium ml-auto">Failed</span>}
            {isDone && <span className="text-[10px] text-emerald-400 font-medium ml-auto">Completed</span>}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {run.appTypeName}
            {run.templateName && <> · {run.templateName}</>}
            {fieldCount > 0 && <> · {filledCount}/{fieldCount} fields set</>}
            {run.startedAt && run.finishedAt && (
              <> · {((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s</>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Button
            size="sm" variant="outline" className="h-7 gap-1 text-xs"
            onClick={onToggleEdit}
          >
            <Edit2 size={11} /> {run.editOpen ? "Close" : "Edit Fields"}
          </Button>
          {run.requestId && isDone && (
            <Button
              size="sm" variant="outline" className="h-7 gap-1 text-xs text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
              onClick={onViewContract}
            >
              <Eye size={11} /> View
            </Button>
          )}
          {!isRunningAll && (
            <Button
              size="sm"
              className={cn("h-7 gap-1 text-xs", isDone || isErr ? "bg-muted hover:bg-muted/80 text-foreground border border-border" : "")}
              variant={isDone || isErr ? "outline" : "default"}
              onClick={onRun} disabled={isRun}
            >
              {isRun ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
              {run.requestId ? "Rerun" : "Run"}
            </Button>
          )}
          <button onClick={onDelete} className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* ── Step pills ── */}
      <div className="px-4 pb-3 flex gap-1.5 flex-wrap border-t border-border/30 pt-3">
        {run.steps.map(s => <StepPill key={s.id} step={s} />)}
      </div>

      {/* ── Error banner ── */}
      {run.error && (
        <div className="mx-4 mb-3 p-2.5 bg-red-500/8 border border-red-500/20 rounded-lg text-xs text-red-400 font-mono leading-relaxed">
          {run.error.split("\n").map((line, i) => (
            <div key={i} className="flex items-start gap-1.5">
              {i === 0 ? <AlertCircle size={11} className="mt-0.5 flex-shrink-0" /> : <span className="w-[11px] flex-shrink-0" />}
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Inline Edit Form ── */}
      {run.editOpen && (
        <div className="border-t border-border/50 bg-muted/10">
          <div className="px-4 py-3 flex items-center justify-between border-b border-border/30">
            <span className="text-xs font-semibold text-foreground">Edit fields for Run #{run.index}</span>
            <Button size="sm" className="h-7 gap-1 text-xs" onClick={onSaveAndRerun}>
              <Play size={11} /> Save & Rerun
            </Button>
          </div>
          <div className="px-4 py-3 max-h-96 overflow-y-auto space-y-4">
            {/* Client & Party overrides per run */}
            <div className="grid grid-cols-2 gap-3 pb-3 border-b border-border/30">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                  Client <span className="text-red-400">*</span>
                </label>
                <select
                  value={run.selectedClientId ?? ""}
                  onChange={e => onClientChange(e.target.value ? Number(e.target.value) : null)}
                  className="w-full h-7 text-xs bg-background border border-border rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">None</option>
                  {liveClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Legal Party</label>
                <select
                  value={run.selectedPartyId ?? ""}
                  onChange={e => onPartyChange(e.target.value ? Number(e.target.value) : null)}
                  className="w-full h-7 text-xs bg-background border border-border rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">None</option>
                  {liveParties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>

            {Object.entries(groupedForEdit).map(([section, sFields]) => (
              <div key={section}>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{section}</p>
                <div className="space-y-2">
                  {sFields.map(f => {
                    const id = String(f.fieldId);
                    return (
                      <div key={id} className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1 mb-0.5">
                            <span className="text-[11px] font-medium truncate">{f.displayName || f.fieldName}</span>
                            {f.isRequired && <span className="text-red-400 text-[9px]">*</span>}
                            <span className="text-[9px] text-muted-foreground/40 font-mono">{f.fieldType}</span>
                          </div>
                          <IntakeFieldInput
                            field={f}
                            value={run.fieldValues[id] ?? ""}
                            onChange={v => onFieldChange(id, v)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {allFields.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No fields available for this run.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BulkTestCreatorPage() {
  const clients = useApiClients();
  const { tenant, username, cloudInstance } = useAuthStore();

  // Config
  const [selAppTypeId, setSelAppTypeId] = useState<number | null>(null);
  const [selTemplateId, setSelTemplateId] = useState<number | null>(null);
  const [runCount, setRunCount] = useState(3);
  const [fillMode, setFillMode] = useState<FillMode>("mandatory");
  const [customSelected, setCustomSelected] = useState<Set<string>>(new Set());
  const [globalValues, setGlobalValues] = useState<Record<string, string>>({});
  const [fieldSearch, setFieldSearch] = useState("");
  const [globalClientId, setGlobalClientId] = useState<number | null>(null);
  const [globalPartyId, setGlobalPartyId] = useState<number | null>(null);

  // ── localStorage keys for custom mode persistence ──────────────────────────
  const lsSelKey  = selAppTypeId ? `btc-custom-sel-${tenant}-${selAppTypeId}` : null;
  const lsValsKey = selAppTypeId ? `btc-custom-vals-${tenant}-${selAppTypeId}` : null;

  // Runs
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const abortRef = useRef(false);

  // Contract edit drawer (view/edit a created contract)
  const [viewContractId, setViewContractId] = useState<number | null>(null);
  const qc = useQueryClient();

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser", tenant, username],
    queryFn: async () => {
      const res = await listUsers(clients!.oldProd, tenant, { requestorUsername: username, search: username, pageNo: 1, perPage: 10 });
      return res.data.find(u =>
        u.userName?.toLowerCase() === username?.toLowerCase() ||
        u.email?.toLowerCase() === username?.toLowerCase()
      ) ?? res.data[0] ?? null;
    },
    enabled: !!clients && !!username,
    staleTime: 10 * 60_000,
  });

  const { data: appTypesRaw = [] } = useQuery({
    queryKey: QK.appTypes(tenant),
    queryFn: async () => {
      const { listApplicationTypes } = await import("@/api/applicationTypes");
      return listApplicationTypes(clients!.oldProd, tenant, tenant);
    },
    enabled: !!clients,
  });

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ["templates", tenant, selAppTypeId],
    queryFn: async () => {
      const res = await getContractTemplates(clients!.newCloud, tenant, selAppTypeId!);
      return (Array.isArray(res) ? res : ((res as any)?.data ?? [])) as any[];
    },
    enabled: !!clients && !!selAppTypeId,
  });

  const { data: intakeGroups = [], isLoading: intakeLoading } = useQuery({
    queryKey: ["intakeFieldsTC", tenant, selAppTypeId],
    queryFn: () => getIntakeFormFields(clients!.newCloud, tenant, selAppTypeId!),
    enabled: !!clients && !!selAppTypeId,
  });

  // Live clients from API — GET /api/{tenant}/client on New Cloud
  const { data: liveClients = [] } = useQuery({
    queryKey: ["bulkClients", tenant],
    queryFn: async () => {
      try {
        const res = await clients!.newCloud.get(`/api/${tenant}/client`);
        // Response: { data: [...], statusCode: 200, totalRecords: N }
        const arr = res.data?.data ?? res.data ?? [];
        return (Array.isArray(arr) ? arr : []).map((c: any) => ({
          id: Number(c.clientId),
          name: String(c.clientName ?? `Client ${c.clientId}`),
        }));
      } catch { return []; }
    },
    enabled: !!clients && !!tenant,
    staleTime: 5 * 60_000,
  });

  // Auto-select first client when list loads
  useEffect(() => {
    if (liveClients.length > 0 && !globalClientId) {
      setGlobalClientId(liveClients[0].id);
    }
  }, [liveClients.length]);

  // Fetch selected client's full detail to get addressDetailId
  const effectiveClientId = globalClientId ?? liveClients[0]?.id ?? null;
  const { data: selectedClientDetail } = useQuery({
    queryKey: ["clientDetail", tenant, effectiveClientId],
    queryFn: async () => {
      // Swagger: GET /api/{tenantName}/Client/{id} → ClientGetByIdResponse
      const res = await clients!.newCloud.get(`/api/${tenant}/client/${effectiveClientId}`);
      const d = res.data?.data ?? res.data;

      // Swagger: ClientAddressDetails has `addressDetailId` (int64)
      //          ClientContactDetails has `contactNumberDetailId` (int64)
      //          ClientEmailDetails has `emailDetailId` (int64)
      //          ClientContactNameDetails has `contactNameDetailId` (int64)
      // All are nullable in ClientBase — send null when the array is empty (never 0)
      const pickId = (arr: any[], idProp: string): number | null => {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        const val = arr[0]?.[idProp];
        return val != null && Number(val) > 0 ? Number(val) : null;
      };

      return {
        clientId:              Number(d.clientId ?? effectiveClientId),
        addressDetailId:       pickId(d.addresses       ?? [], "addressDetailId"),
        contactNumberDetailId: pickId(d.contactNumbers  ?? [], "contactNumberDetailId"),
        emailDetailId:         pickId(d.emails          ?? [], "emailDetailId"),
        contactNameDetailId:   pickId(d.contactNames    ?? [], "contactNameDetailId"),
      };
    },
    enabled: !!clients && !!effectiveClientId,
    staleTime: 5 * 60_000,
  });

  // Live legal parties from API
  const { data: liveParties = [] } = useQuery({
    queryKey: ["bulkParties", tenant],
    queryFn: async () => {
      try {
        const res = await clients!.newCloud.get(`/api/${tenant}/legal-party`, {
          params: { PageNo: 1, PerPage: 200, IsActive: true },
        });
        const arr = res.data?.data ?? res.data ?? [];
        return (Array.isArray(arr) ? arr : []).map((p: any) => ({
          id: Number(p.id ?? p.legalPartyId),
          name: String(p.name ?? p.legalPartyName ?? `Party ${p.id}`),
        }));
      } catch { return []; }
    },
    enabled: !!clients && !!tenant,
    staleTime: 5 * 60_000,
  });

  // Contract detail + intake map for the edit drawer
  const { data: drawerDetail = null, isLoading: drawerLoading } = useQuery({
    queryKey: QK.contractDetail(tenant, viewContractId ?? 0),
    queryFn: () => getContractDetail(clients!.newCloud, tenant, viewContractId!),
    enabled: !!clients && !!viewContractId,
  });

  const { data: drawerFieldDefs } = useQuery({
    queryKey: [...QK.fieldDefs(tenant, selAppTypeId ?? undefined), "withOptions"],
    queryFn: () => listFieldDefinitions(clients!.newCloud, tenant, {
      applicationTypeId: selAppTypeId!,
      showOptions: true,
      pageSize: 500,
    }),
    enabled: !!clients && !!selAppTypeId,
    staleTime: 5 * 60_000,
  });

  const drawerIntakeMap = useMemo(() => {
    const map: Record<number, IntakeFormField> = {};
    for (const g of intakeGroups) {
      for (const s of (g.sections ?? [])) {
        for (const f of (s.fields ?? [])) {
          if (f.fieldId) map[f.fieldId] = f;
        }
      }
    }
    return map;
  }, [intakeGroups]);

  const drawerFieldOptionsMap = useMemo(() => {
    const map: Record<number, FieldOption[]> = {};
    if (drawerFieldDefs?.data) {
      for (const f of drawerFieldDefs.data) {
        if (f.options?.length) map[f.fieldId] = f.options;
      }
    }
    return map;
  }, [drawerFieldDefs]);

  const updateMutation = useMutation({
    mutationFn: async ({ detail, editedFields, editedDescription }: {
      detail: ContractDetail;
      editedFields: Record<number, string>;
      editedDescription?: string;
    }) => {
      if (!clients) throw new Error("Not connected");
      const payload = buildUpdatePayload(detail, editedFields, editedDescription, username);
      return updateContract(clients.newCloud, tenant, detail.id, payload);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: QK.contractDetail(tenant, vars.detail.id) });
      toast.success("Contract updated");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Build fallback options map from metadata field defs (for dropdowns that have no selectOptions in intake form)
  const metaOptsMap = useMemo((): Record<number, Record<string, string>> => {
    const map: Record<number, Record<string, string>> = {};
    if (!drawerFieldDefs?.data) return map;
    for (const f of drawerFieldDefs.data) {
      if (f.options?.length) {
        const opts: Record<string, string> = {};
        for (const o of f.options) {
          const k = String((o as any).fieldOptionId ?? (o as any).id ?? (o as any).optionId ?? (o as any).value ?? "");
          const v = String((o as any).fieldOptionValue ?? (o as any).optionName ?? (o as any).label ?? (o as any).value ?? k);
          if (k) opts[k] = v;
        }
        if (Object.keys(opts).length > 0) map[f.fieldId] = opts;
      }
    }
    return map;
  }, [drawerFieldDefs]);

  // Flatten all intake fields, merging in metadata options where intake form has none
  const allFields = useMemo((): FlatField[] => {
    const seen = new Set<number>();
    const out: FlatField[] = [];

    function pushField(f: any, groupName: string, groupType: string, sectionName: string) {
      if (!f.fieldId || seen.has(f.fieldId)) return;
      seen.add(f.fieldId);
      const mergedOpts = (f.selectOptions && Object.keys(f.selectOptions).length > 0)
        ? f.selectOptions
        : (metaOptsMap[f.fieldId] ?? f.selectOptions ?? null);
      out.push({ 
        ...f, 
        selectOptions: mergedOpts, 
        groupName, 
        groupType, 
        sectionName,
        isMandatory: !!f.isMandatory 
      });
    }

    for (const g of intakeGroups) {
      const groupName = (g as any).groupName || (g as any).name || "General";
      const groupType = (g as any).groupType || "Custom";

      // Fields nested in sections (primary structure)
      for (const s of (g.sections ?? [])) {
        const sectionName = (s as any).sectionName || (s as any).name || groupName;
        for (const f of (s.fields ?? [])) pushField(f, groupName, groupType, sectionName);
      }

      // Fields placed directly on the group (secondary structure — some app types use this)
      for (const f of ((g as any).fields ?? [])) pushField(f, groupName, groupType, groupName);
    }
    return out;
  }, [intakeGroups, metaOptsMap]);

  // Fields filtered by search for sidebar display
  const filteredFields = useMemo(() => {
    if (!fieldSearch.trim()) return allFields;
    const q = fieldSearch.toLowerCase();
    return allFields.filter(f =>
      (f.displayName || f.fieldName)?.toLowerCase().includes(q) ||
      f.fieldType?.toLowerCase().includes(q)
    );
  }, [allFields, fieldSearch]);

  // Recompute global values when fields/fillMode changes
  useEffect(() => {
    if (allFields.length === 0) return;
    const newVals = buildInitialValues(allFields, fillMode, customSelected, metaOptsMap);
    setGlobalValues(newVals);
  }, [allFields, fillMode, customSelected, metaOptsMap]);

  // Auto-select mandatory fields in custom mode when fields load (or restore from localStorage)
  useEffect(() => {
    if (allFields.length === 0) return;

    // 1. Calculate the mandatory fields that MUST be checked
    const mandatorySet = new Set(allFields.filter(isMandatory).map(f => String(f.fieldId)));

    // 2. Try restoring saved selection from localStorage
    let nextSet = new Set<string>();
    if (lsSelKey) {
      try {
        const saved = localStorage.getItem(lsSelKey);
        if (saved) {
          const parsed: string[] = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            parsed.forEach(id => nextSet.add(id));
          }
        }
      } catch {}
    }

    // 3. ALWAYS merge mandatory fields into the set (user request: pre-selected)
    mandatorySet.forEach(id => nextSet.add(id));

    // 4. Update state
    setCustomSelected(nextSet);

    // 5. Restore saved values if possible
    if (lsValsKey) {
      try {
        const savedVals = localStorage.getItem(lsValsKey);
        if (savedVals) {
          const parsedVals = JSON.parse(savedVals);
          setGlobalValues(prev => ({ ...prev, ...parsedVals }));
        }
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFields.length, lsSelKey]);

  // When switching TO custom mode or mandatory mode, ensure state is synced
  useEffect(() => {
    if (fillMode === "custom" || fillMode === "mandatory") {
      const mandatoryFields = allFields.filter(isMandatory);
      if (mandatoryFields.length > 0) {
        setCustomSelected(prev => {
          const next = new Set(prev ?? []);
          mandatoryFields.forEach(f => next.add(String(f.fieldId)));
          return next;
        });
      }
    }
  }, [fillMode, allFields]);

  // Persist custom selection + values to localStorage whenever they change
  useEffect(() => {
    if (!lsSelKey || !lsValsKey || fillMode !== "custom") return;
    try {
      localStorage.setItem(lsSelKey, JSON.stringify(Array.from(customSelected)));
      localStorage.setItem(lsValsKey, JSON.stringify(globalValues));
    } catch {}
  }, [customSelected, globalValues, lsSelKey, lsValsKey, fillMode]);

  const selectedAppType = (appTypesRaw as any[]).find(a => a.applicationTypeId === selAppTypeId);
  const selectedTemplate = templates.find(t => (t.contractTemplateId || t.id) === selTemplateId);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const patchRun = useCallback((id: string, patch: Partial<TestRun>) => {
    setRuns(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }, []);

  const patchStep = useCallback((runId: string, stepId: string, patch: Partial<TestStep>) => {
    setRuns(prev => prev.map(r =>
      r.id === runId ? { ...r, steps: r.steps.map(s => s.id === stepId ? { ...s, ...patch } : s) } : r
    ));
  }, []);

  function handlePrepare() {
    if (!selAppTypeId || !selectedAppType) return toast.error("Select an Application Type first");
    const prepareClientId = globalClientId ?? liveClients[0]?.id ?? null;
    if (!prepareClientId) return toast.error("Select a Client — it is required by the API");
    const values = buildInitialValues(allFields, fillMode, customSelected, metaOptsMap);
    const newRuns: TestRun[] = Array.from({ length: runCount }, (_, i) => ({
      id: `run-${Date.now()}-${i}`,
      index: i + 1,
      appTypeId: selAppTypeId,
      appTypeName: selectedAppType.applicationTypeName ?? "Unknown",
      templateId: selTemplateId ?? undefined,
      templateName: selectedTemplate ? (selectedTemplate.contractTemplateName || selectedTemplate.name) : undefined,
      status: "idle",
      steps: buildSteps(),
      fieldValues: { ...values },
      selectedClientId: prepareClientId,
      selectedPartyId: globalPartyId,
      editOpen: false,
    }));
    setRuns(newRuns);
    toast.success(`${runCount} run${runCount !== 1 ? "s" : ""} prepared`);
  }

  async function executeRun(run: TestRun) {
    if (!clients) return;
    const userId = currentUser?.userId ?? currentUser?.id ?? 0;
    const deptId = Math.max(currentUser?.departmentId ?? 1, 1);

    patchRun(run.id, { status: "running", startedAt: Date.now(), error: undefined, editOpen: false });
    setRuns(prev => prev.map(r => r.id === run.id ? { ...r, steps: buildSteps() } : r));

    try {
      // Step 1: Create / Update
      patchStep(run.id, "create", { status: "running" });
      const t0 = Date.now();

      // Get latest fieldValues from state
      const latestRun = await new Promise<TestRun>(res => {
        setRuns(prev => { const r = prev.find(r => r.id === run.id) ?? run; res(r); return prev; });
      });

      const runClientId = latestRun.selectedClientId ?? globalClientId ?? liveClients[0]?.id ?? null;
      const runPartyId = latestRun.selectedPartyId ?? globalPartyId;
      const payload = buildPayload(latestRun, allFields, userId, deptId, username, runClientId, runPartyId, metaOptsMap, selectedClientDetail);
      let requestId = run.requestId;

      if (requestId) {
        // Robust Rerun Pattern: Fetch latest detail first, then merge metadata
        const currentDetail = await getContractDetail(clients.newCloud, tenant, requestId);
        
        // Convert fieldValues Record<string, string> to Record<number, string> for buildUpdatePayload
        const numericEdits: Record<number, string> = {};
        Object.entries(latestRun.fieldValues).forEach(([k, v]) => {
          if (v) numericEdits[Number(k)] = v;
        });

        const updatePayload = buildUpdatePayload(currentDetail, numericEdits, undefined, username);
        
        await updateContract(clients.newCloud, tenant, requestId, updatePayload);
        patchStep(run.id, "create", { status: "pass", result: `Updated REQ-${requestId}`, durationMs: Date.now() - t0 });
      } else {
        const res = await createContract(clients.newCloud, tenant, payload);
        requestId = typeof res === "number" ? res : (res as any)?.id ?? (res as any)?.requestId ?? (res as any)?.data;
        if (!requestId || isNaN(Number(requestId))) throw new Error(`No request ID in response: ${JSON.stringify(res)}`);
        requestId = Number(requestId);
        patchStep(run.id, "create", { status: "pass", result: `Created REQ-${requestId}`, durationMs: Date.now() - t0 });
        patchRun(run.id, { requestId });
      }

      // Step 2: Document Generation (Generate Version)
      if (run.templateId) {
        patchStep(run.id, "generate", { status: "running" });
        const tg = Date.now();
        try {
          await generateContractVersion(clients.newCloud, tenant, { 
            requestId: requestId!, 
            contractTemplateId: run.templateId 
          });
          patchStep(run.id, "generate", { status: "pass", result: "Version generated", durationMs: Date.now() - tg });
        } catch (e: any) {
          patchStep(run.id, "generate", { status: "warn", result: "Gen failed", durationMs: Date.now() - tg });
        }
      } else {
        patchStep(run.id, "generate", { status: "idle", result: "No template" });
      }

      // Step 3: Fetch & Verify
      patchStep(run.id, "fetch", { status: "running" });
      const t1 = Date.now();
      const detail = await getContractDetail(clients.newCloud, tenant, requestId!);
      const stage = (detail as any)?.workflowStage ?? (detail as any)?.currentStage ?? "Unknown";
      patchStep(run.id, "fetch", { status: "pass", result: `Stage: ${stage}`, durationMs: Date.now() - t1 });
      patchRun(run.id, { currentStage: stage });

      // Step 3: Approvals
      patchStep(run.id, "approvals", { status: "running" });
      const t2 = Date.now();
      try {
        const appRes: any = await getPreExecutionApprovals(clients.newCloud, tenant, requestId!);
        const list = appRes?.data?.approvals ?? appRes?.approvals ?? appRes?.data ?? [];
        const count = Array.isArray(list) ? list.length : 0;
        patchStep(run.id, "approvals", { status: "pass", result: `${count} approval trigger${count !== 1 ? "s" : ""}`, durationMs: Date.now() - t2 });
      } catch {
        patchStep(run.id, "approvals", { status: "warn", result: "Approval graph unavailable", durationMs: Date.now() - t2 });
      }

      // Step 4: Workflow stage
      patchStep(run.id, "stage", { status: stage !== "Unknown" ? "pass" : "warn", result: stage });

      // Step 5: Metadata audit
      patchStep(run.id, "fields", { status: "running" });
      const savedCount = ((detail as any)?.customFieldGroups ?? [])
        .reduce((a: number, g: any) => a + (g.customFields?.length ?? 0), 0);
      patchStep(run.id, "fields", {
        status: savedCount > 0 ? "pass" : "warn",
        result: `${savedCount} custom field${savedCount !== 1 ? "s" : ""} saved`,
      });

      patchRun(run.id, { status: "done", finishedAt: Date.now() });
    } catch (e: any) {
      const msg = extractApiError(e);
      patchRun(run.id, { status: "error", error: msg, finishedAt: Date.now() });
      setRuns(prev => prev.map(r =>
        r.id === run.id ? {
          ...r, steps: r.steps.map(s =>
            s.status === "idle" || s.status === "running"
              ? { ...s, status: "fail", result: "Aborted" }
              : s
          )
        } : r
      ));
    }
  }

  async function executeAll() {
    if (runs.length === 0) return;
    abortRef.current = false;
    setIsRunningAll(true);
    for (const run of runs) {
      if (abortRef.current) break;
      await executeRun(run);
      await new Promise(r => setTimeout(r, 400));
    }
    setIsRunningAll(false);
    toast.success("All runs complete");
  }

  // Stats
  const stats = useMemo(() => ({
    total: runs.length,
    done: runs.filter(r => r.status === "done").length,
    errors: runs.filter(r => r.status === "error").length,
    running: runs.filter(r => r.status === "running").length,
    idle: runs.filter(r => r.status === "idle").length,
  }), [runs]);

  // ── Render ────────────────────────────────────────────────────────────────

  const mandatoryCount = allFields.filter(isMandatory).length;
  const selectedCount = fillMode === "mandatory" ? mandatoryCount
    : fillMode === "all" ? allFields.length
    : customSelected.size;

  return (
    <>
    <div className="space-y-4">
      <PageHeader
        title="Bulk Test Creator"
        description="Create multiple contract requests with configurable field values and track results."
        actions={
          <div className="flex items-center gap-2">
            {runs.length > 0 && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportCSV(runs)}>
                <Download size={13} /> Export CSV
              </Button>
            )}
            {runs.length > 0 && !isRunningAll && (
              <Button size="sm" className="gap-1.5" onClick={executeAll}>
                <Play size={13} /> Run All ({runs.length})
              </Button>
            )}
            {isRunningAll && (
              <Button size="sm" variant="destructive" className="gap-1.5" onClick={() => abortRef.current = true}>
                <XCircle size={13} /> Abort
              </Button>
            )}
          </div>
        }
      />

      <div className="flex gap-6 items-start">

        {/* ── LEFT SIDEBAR ── */}
        <div className="w-[320px] flex-shrink-0 space-y-3 sticky top-4">

          {/* Setup card */}
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/20">
              <h3 className="text-sm font-semibold">Setup</h3>
              {currentUser && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Running as <span className="text-foreground font-medium">{currentUser.fullName}</span> · #{currentUser.userId}
                </p>
              )}
            </div>
            <div className="p-4 space-y-3">
              {/* App type */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Application Type</label>
                <select
                  value={selAppTypeId ?? ""}
                  onChange={e => { setSelAppTypeId(e.target.value ? Number(e.target.value) : null); setSelTemplateId(null); setRuns([]); }}
                  className="w-full h-9 text-sm bg-background border border-border rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">— Select type —</option>
                  {(appTypesRaw as any[]).map(at => (
                    <option key={at.applicationTypeId} value={at.applicationTypeId}>{at.applicationTypeName}</option>
                  ))}
                </select>
              </div>

              {/* Template */}
              {selAppTypeId && (
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Template (optional)</label>
                  <select
                    value={selTemplateId ?? ""}
                    onChange={e => setSelTemplateId(e.target.value ? Number(e.target.value) : null)}
                    className="w-full h-9 text-sm bg-background border border-border rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">None</option>
                    {templatesLoading ? <option disabled>Loading…</option> :
                      templates.map(t => <option key={t.contractTemplateId || t.id} value={t.contractTemplateId || t.id}>{t.contractTemplateName || t.name}</option>)}
                  </select>
                </div>
              )}

              {/* Client (required) */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                  Client <span className="text-red-400">*</span>
                  {liveClients.length === 0 && <span className="normal-case font-normal text-muted-foreground ml-1">(loading…)</span>}
                </label>
                <select
                  value={globalClientId ?? ""}
                  onChange={e => setGlobalClientId(e.target.value ? Number(e.target.value) : null)}
                  className={cn(
                    "w-full h-9 text-sm bg-background border rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-ring",
                    !globalClientId ? "border-red-500/50" : "border-border"
                  )}
                >
                  <option value="">— required —</option>
                  {liveClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {!globalClientId && (
                  <p className="text-[10px] text-red-400 mt-0.5">Client is required by the API</p>
                )}
              </div>

              {/* Legal Party (optional) */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                  Legal Party <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <select
                  value={globalPartyId ?? ""}
                  onChange={e => setGlobalPartyId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full h-9 text-sm bg-background border border-border rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">None</option>
                  {liveParties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              {/* Run count + prepare */}
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Number of Runs</label>
                  <Input type="number" min={1} max={50} value={runCount}
                    onChange={e => setRunCount(Math.max(1, Math.min(50, Number(e.target.value))))}
                    className="h-9 text-sm" />
                </div>
                <Button
                  className="h-9 gap-1.5 flex-shrink-0"
                  onClick={handlePrepare}
                  disabled={!selAppTypeId || intakeLoading}
                >
                  {intakeLoading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  Prepare
                </Button>
              </div>
            </div>
          </div>

          {/* Fill mode + field selector */}
          {selAppTypeId && (
            <div className="border border-border rounded-xl bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Field Fill Mode</h3>
                {allFields.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">{selectedCount}/{allFields.length} selected</span>
                )}
              </div>

              {/* Mode selector */}
              <div className="p-3 flex gap-1.5 border-b border-border">
                {(["mandatory", "all", "custom"] as FillMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setFillMode(m)}
                    className={cn(
                      "flex-1 text-[11px] font-semibold py-1.5 rounded-md border transition-all capitalize",
                      fillMode === m
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-transparent border-border text-muted-foreground hover:border-foreground/30"
                    )}
                  >
                    {m === "mandatory" ? "Required" : m === "all" ? "All" : "Custom"}
                  </button>
                ))}
              </div>

              {/* Mode description */}
              <div className="px-3 py-2 text-[10px] text-muted-foreground border-b border-border/50">
                {fillMode === "mandatory" && `Auto-fill ${mandatoryCount} required field${mandatoryCount !== 1 ? "s" : ""} with dummy data.`}
                {fillMode === "all" && `Auto-fill all ${allFields.length} fields with dummy data.`}
                {fillMode === "custom" && "Choose which fields to include and set their default values."}
              </div>

              {/* Field list */}
              {intakeLoading ? (
                <div className="flex justify-center py-6"><Spinner size={20} /></div>
              ) : (
                <div>
                  {/* Search */}
                  <div className="p-2 border-b border-border/50 relative">
                    <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search fields…"
                      value={fieldSearch}
                      onChange={e => setFieldSearch(e.target.value)}
                      className="h-7 text-xs pl-7 pr-6"
                    />
                    {fieldSearch && (
                      <button onClick={() => setFieldSearch("")} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X size={11} />
                      </button>
                    )}
                  </div>

                  <div className="overflow-y-auto max-h-[380px] divide-y divide-border/30">
                    {filteredFields.map(f => {
                      const id = String(f.fieldId);
                      const mandatory = isMandatory(f);
                      const isChecked = fillMode === "all" ? true : fillMode === "mandatory" ? mandatory : customSelected.has(id);
                      const val = globalValues[id] ?? "";
                      const hasOptions = !!(f.selectOptions && Object.keys(f.selectOptions).length > 0) || !!(f.values?.length);

                      return (
                        <div key={id} className={cn("px-3 py-2 space-y-1", !isChecked && fillMode !== "custom" && "opacity-40")}>
                          {/* Field label row */}
                          <div className="flex items-center gap-1.5">
                            {fillMode === "custom" ? (
                              <button
                                onClick={() => {
                                  setCustomSelected(prev => {
                                    const next = new Set(prev ?? []);
                                    if (next.has(id)) next.delete(id); else next.add(id);
                                    return next;
                                  });
                                }}
                                className="flex-shrink-0 text-muted-foreground hover:text-primary transition-colors"
                              >
                                {customSelected.has(id) || mandatory ? <CheckSquare size={13} className="text-primary" /> : <Square size={13} />}
                              </button>
                            ) : (
                              <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", isChecked ? "bg-primary" : "bg-border")} />
                            )}
                            <span className="text-[11px] font-medium flex-1 min-w-0 truncate">
                              {f.displayName || f.fieldName}
                              {mandatory && <span className="text-red-400 ml-0.5">*</span>}
                            </span>
                            <span className="text-[9px] text-muted-foreground/40 font-mono flex-shrink-0">{f.fieldType}</span>
                          </div>

                          {/* Value editor (shown when selected) */}
                          {isChecked && (
                            <div className="pl-5">
                              {hasOptions ? (
                                <select
                                  value={val}
                                  onChange={e => setGlobalValues(p => ({ ...p, [id]: e.target.value }))}
                                  className="w-full h-6 text-[11px] bg-background border border-border/60 rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                                >
                                  <option value="">— auto —</option>
                                  {f.selectOptions
                                    ? Object.entries(f.selectOptions).map(([k, v]) => <option key={k} value={(v as string) || k}>{(v as string) || k}</option>)
                                    : f.values?.map(v => <option key={v.value} value={v.label || v.value}>{v.label || v.value}</option>)
                                  }
                                </select>
                              ) : (
                                <input
                                  value={val}
                                  onChange={e => setGlobalValues(p => ({ ...p, [id]: e.target.value }))}
                                  placeholder="auto-generated"
                                  className="w-full h-6 text-[11px] bg-background border border-border/60 rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {filteredFields.length === 0 && (
                      <div className="py-6 text-center text-xs text-muted-foreground">
                        {allFields.length === 0 ? "No intake fields found" : "No fields match search"}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT CONTENT ── */}
        <div className="flex-1 min-w-0 space-y-3">

          {/* Stats bar */}
          {runs.length > 0 && (
            <div className="border border-border rounded-xl bg-card p-3 flex items-center gap-4 flex-wrap">
              <StatPill label="Total" value={stats.total} />
              <StatPill label="Done" value={stats.done} color="emerald" />
              <StatPill label="Errors" value={stats.errors} color="red" />
              <StatPill label="Running" value={stats.running} color="blue" />
              <StatPill label="Idle" value={stats.idle} />
              <div className="flex-1" />
              {isRunningAll && (
                <div className="flex items-center gap-2 text-xs text-blue-400">
                  <Loader2 size={12} className="animate-spin" /> Running…
                </div>
              )}
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => { setRuns([]); }}>
                <Trash2 size={11} /> Clear all
              </Button>
            </div>
          )}

          {/* Empty state */}
          {runs.length === 0 && (
            <div className="border border-dashed border-border rounded-xl bg-card/30 flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center mb-4">
                <FlaskConical size={28} className="text-primary/40" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-semibold mb-1">No runs prepared</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                {selAppTypeId
                  ? "Configure your fill mode and click Prepare to create test runs."
                  : "Select an application type from the left to get started."}
              </p>
            </div>
          )}

          {/* Run cards */}
          {runs.map(run => (
            <RunCard
              key={run.id}
              run={run}
              allFields={allFields}
              cloudInstance={cloudInstance || ""}
              liveClients={liveClients}
              liveParties={liveParties}
              isRunningAll={isRunningAll}
              onRun={() => executeRun(run)}
              onDelete={() => setRuns(prev => prev.filter(r => r.id !== run.id))}
              onToggleEdit={() => patchRun(run.id, { editOpen: !run.editOpen })}
              onFieldChange={(fieldId, value) => {
                setRuns(prev => prev.map(r =>
                  r.id === run.id
                    ? { ...r, fieldValues: { ...r.fieldValues, [fieldId]: value } }
                    : r
                ));
              }}
              onClientChange={(id) => patchRun(run.id, { selectedClientId: id })}
              onPartyChange={(id) => patchRun(run.id, { selectedPartyId: id })}
              onSaveAndRerun={() => executeRun(run)}
              onViewContract={() => run.requestId && setViewContractId(run.requestId)}
            />
          ))}
        </div>
      </div>
    </div>

    {/* ── Contract edit drawer ── */}
    {viewContractId && (
      <ContractEditDrawer
        detail={drawerDetail as ContractDetail | null}
        loading={drawerLoading}
        intakeFieldMap={drawerIntakeMap}
        fieldOptionsMap={drawerFieldOptionsMap}
        onClose={() => setViewContractId(null)}
        onSave={async (detail, editedFields, editedDescription) => {
          await updateMutation.mutateAsync({ detail, editedFields, editedDescription });
        }}
        saving={updateMutation.isPending}
        saveError={updateMutation.isError ? (updateMutation.error as Error).message : null}
      />
    )}
    </>
  );
}

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function StatPill({ label, value, color }: { label: string; value: number; color?: "emerald" | "red" | "blue" }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn(
        "text-lg font-bold tabular-nums",
        color === "emerald" ? "text-emerald-500" :
        color === "red" ? "text-red-500" :
        color === "blue" ? "text-blue-500" :
        "text-foreground"
      )}>{value}</span>
      <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}</span>
    </div>
  );
}
