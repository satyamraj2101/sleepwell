import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FlaskConical, CheckCircle2, Trash2, Play, AlertCircle, Download,
  XCircle, Loader2, Plus, Edit2, X, Search, Clock,
  Copy, ExternalLink, CheckSquare, Square, AlertTriangle, RotateCcw, Eye,
  FileText, Users, Shield, GitBranch, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Spinner } from "@/components/shared/PageHeader";
import { useApiClients } from "@/hooks/useApiClients";
import { useAuthStore } from "@/store/authStore";
import { QK, cn } from "@/lib/utils";
import { getIntakeFormFields, createContract, getContractDetail, updateContract, buildUpdatePayload, getQuestionnaire, submitQuestionnaire } from "@/api/contractRequest";
import { getContractTemplates } from "@/api/applicationTypes";
import { getPreExecutionApprovals } from "@/api/approval";
import { listUsers } from "@/api/users";
import { listFieldDefinitions } from "@/api/metadata";
import { ContractEditDrawer } from "@/features/contract-edit/components/ContractEditDrawer";
import type { IntakeFormField, ContractDetail, FieldOption, PreExecutionApproval, AssigneeRef, ClientRef, LegalPartyRef } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface VersionRecord {
  versionId: number;
  collaborationDocumentId?: number;
  url?: string;
  fileName?: string;
  versionNumber?: number;
  isGeneratedFromTemplate?: boolean;
  isLocked?: boolean;
  isPdf?: boolean;
  isDocx?: boolean;
  addedByName?: string;
  addedOn?: string;
  collaborators?: Array<{ id: number; userId: number; fullName?: string; email?: string; status?: string }>;
}

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
  templateId?: number;       // global template (from Setup, or auto-selected)
  templateName?: string;
  selectedTemplateId?: number;  // per-run override (only shown when multiple templates)
  selectedTemplateName?: string;
  requestId?: number;
  recordId?: number;
  generatedVersionId?: number;  // versionId from version-history after run
  generatedFileName?: string;
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
  approvals?: PreExecutionApproval[];
  contractAssignees?: AssigneeRef[];
  contractClients?: ClientRef[];
  contractParties?: LegalPartyRef[];
  requesterName?: string;
  versions?: VersionRecord[];
  actionTaken?: boolean;
  availableActions?: Array<{ code: string; workflowCommandName?: string; displayText?: string }>;
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
  roleId?: number | null;
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
    contractTemplateId: run.selectedTemplateId ?? run.templateId ?? 0,
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
    { id: "create",    label: "Create / Update",  status: "idle" },
    { id: "version",   label: "Version History",  status: "idle" },
    { id: "fetch",     label: "Fetch & Verify",   status: "idle" },
    { id: "approvals", label: "Approval Check",   status: "idle" },
    { id: "stage",     label: "Workflow Stage",   status: "idle" },
    { id: "fields",    label: "Metadata Audit",   status: "idle" },
  ];
}

// ─── File Preview Dialog ──────────────────────────────────────────────────────
function FilePreviewDialog({
  versionId, fileName, tenant, newCloudApi, token, onClose,
}: {
  versionId: number;
  fileName: string;
  tenant: string;
  newCloudApi: string;
  token: string;
  onClose: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isPdf = fileName.toLowerCase().endsWith(".pdf");

  useEffect(() => {
    let url: string | null = null;
    setLoading(true);
    setError(null);

    // Force PDF (1) for browser preview compatibility
    const fmtCode = 1;
    const downloadUrl = `https://${newCloudApi}/api/${tenant}/version/${versionId}/download?format=${fmtCode}&FromPreviewPage=false&IncludeComments=false`;
    
    fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.blob();
      })
      .then(blob => {
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setLoading(false);
      })
      .catch(e => {
        setError(e.message);
        setLoading(false);
      });

    return () => { if (url) URL.revokeObjectURL(url); };
  }, [versionId, tenant, newCloudApi, token, isPdf]);

  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName || `version-${versionId}.${isPdf ? "pdf" : "docx"}`;
    a.click();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[1100]" onClick={onClose} />
      <div className="fixed inset-4 md:inset-8 bg-[#0f1117] border border-white/10 rounded-2xl z-[1101] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07] flex-shrink-0">
          <div className="flex items-center gap-3">
            <FileText size={15} className="text-amber-400" />
            <div>
              <span className="text-[13px] font-semibold text-white">{fileName || `Version ${versionId}`}</span>
              <span className="text-[10px] text-white/30 ml-2">· version ID {versionId}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="outline"
              className="h-7 gap-1.5 text-xs border-white/10 text-white/70 hover:text-white"
              onClick={handleDownload} disabled={!blobUrl}
            >
              <Download size={11} /> Download {isPdf ? "PDF" : "DOCX"}
            </Button>
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/[0.06] transition-all">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 relative">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <Loader2 size={28} className="animate-spin text-amber-400" />
              <span className="text-[12px] text-white/40">Loading document…</span>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <AlertCircle size={28} className="text-red-400" />
              <p className="text-[12px] text-red-400">{error}</p>
              <p className="text-[11px] text-white/30">Use the Download button above to save the file.</p>
            </div>
          )}
          {blobUrl && (
            <iframe src={blobUrl} className="w-full h-full border-0" title="Document preview" />
          )}
          {!blobUrl && !loading && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              <FileText size={48} className="text-white/10" />
              <p className="text-[13px] text-white/50">Preview is not available for this file type.</p>
              <Button size="sm" className="gap-1.5 bg-amber-500 hover:bg-amber-400 text-black" onClick={handleDownload}>
                <Download size={13} /> Download to view
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
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
  onFieldChange, onClientChange, onPartyChange,
  onSaveAndRerun, onViewContract, onPreviewDoc, onPreviewVersion, isRunningAll,
  newCloudApi,
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
  onPreviewDoc: () => void;
  onPreviewVersion: (versionId: number, fileName: string) => void;
  isRunningAll: boolean;
  newCloudApi: string;
}) {
  const { tenant, token } = useAuthStore();
  const isRun = run.status === "running";
  const isErr = run.status === "error";
  const isDone = run.status === "done";
  const [detailsOpen, setDetailsOpen] = useState(true);

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

  // All collaborators/signatories from all versions
  const allSignatories = useMemo(() => {
    const seen = new Set<number>();
    const out: Array<{ id: number; userId: number; fullName?: string; email?: string }> = [];
    for (const v of (run.versions ?? [])) {
      for (const c of (v.collaborators ?? [])) {
        if (c.userId && !seen.has(c.userId)) {
          seen.add(c.userId);
          out.push(c);
        }
      }
    }
    return out;
  }, [run.versions]);

  const hasDetails = isDone || isErr;

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

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">Run #{run.index}</span>
            {run.requestId && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-mono bg-muted border border-border px-2 py-0.5 rounded shadow-sm">
                <span className="text-blue-400 font-bold">REQ-{run.requestId}</span>
                {run.recordId && (
                  <span className="text-emerald-400/80 border-l border-border pl-1.5 ml-0.5" title="Leah Record ID">
                    REC-{run.recordId}
                  </span>
                )}
                <div className="flex items-center gap-1 ml-1 border-l border-border pl-1.5">
                  <button onClick={() => { navigator.clipboard.writeText(String(run.requestId)); toast.success("Request ID Copied"); }} className="hover:text-foreground text-muted-foreground transition-colors" title="Copy Request ID"><Copy size={9} /></button>
                  <a href={`https://${cloudInstance}/${tenant ? (tenant.charAt(0).toUpperCase() + tenant.slice(1)) : ""}/#/contract-snapshot/${run.requestId}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 transition-colors" title="Open in Leah"><ExternalLink size={9} /></a>
                </div>
              </span>
            )}
            {run.currentStage && (
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border",
                run.currentStage.toLowerCase().includes("complete") ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                run.currentStage.toLowerCase().includes("negotiat") ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                run.currentStage.toLowerCase().includes("approv") ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
              )}>
                <GitBranch size={8} className="inline mr-0.5" />{run.currentStage}
              </span>
            )}
            {run.actionTaken && isDone && (
              <span className="px-1.5 py-0.5 rounded text-[9px] bg-teal-500/10 border border-teal-500/20 text-teal-400 font-medium">
                ACTION TAKEN
              </span>
            )}
            {isErr && <span className="text-[10px] text-red-400 font-medium ml-auto">Failed</span>}
            {isDone && <span className="text-[10px] text-emerald-400 font-medium ml-auto">✓ Pass</span>}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5">
            <span>{run.appTypeName}</span>
            {(run.templateName || run.selectedTemplateName) && (
              <span className="text-amber-400/70">· {run.selectedTemplateName || run.templateName}</span>
            )}
            {fieldCount > 0 && <span>· {filledCount}/{fieldCount} fields</span>}
            {run.startedAt && run.finishedAt && <span>· {((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s</span>}
            {(run.versions?.length ?? 0) > 0 && (
              <span className="text-emerald-400">· {run.versions!.length} version{run.versions!.length !== 1 ? "s" : ""}</span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasDetails && (
            <button
              onClick={() => setDetailsOpen(o => !o)}
              className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title={detailsOpen ? "Collapse details" : "Expand details"}
            >
              {detailsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onToggleEdit}>
            <Edit2 size={11} /> {run.editOpen ? "Close" : "Edit"}
          </Button>
          {run.requestId && isDone && (
            <Button 
              size="sm" variant="outline" 
              className="h-7 gap-1 text-xs text-blue-400 border-blue-500/30 hover:bg-blue-500/10" 
              onClick={onViewContract}
            >
              <Eye size={11} /> View
            </Button>
          )}
          {isDone && (
            <Button 
              size="sm" variant="outline" 
              className="h-7 gap-1 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 disabled:opacity-30" 
              onClick={onPreviewDoc} 
              disabled={!run.generatedVersionId}
              title={!run.generatedVersionId ? "Waiting for version history..." : "Preview document as PDF"}
            >
              <FileText size={11} /> Preview
            </Button>
          )}
          {run.generatedVersionId && isDone && (
            <Button 
              size="sm" variant="outline" 
              className="h-7 px-2 flex items-center gap-1 text-[11px] font-medium rounded-md border border-blue-500/30 bg-background text-blue-400 hover:bg-blue-500/10 transition-colors"
              title="Download original DOCX"
              onClick={() => {
                const url = `https://${newCloudApi}/api/${tenant}/version/${run.generatedVersionId}/download?format=0&FromPreviewPage=false&IncludeComments=false`;
                fetch(url, { headers: { Authorization: `Bearer ${token}` } })
                  .then(r => r.blob())
                  .then(blob => {
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = run.generatedFileName || `version-${run.generatedVersionId}.docx`;
                    link.click();
                  })
                  .catch(err => toast.error("Download failed: " + err.message));
              }}
            >
              <Download size={11} /> Word
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

      {/* Available Actions Section */}
      {run.availableActions && run.availableActions.length > 0 && (
        <div className="px-4 pb-3 pt-1 border-t border-border/40">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Shield size={11} className="text-blue-400" /> Available Actions
          </div>
          <div className="flex flex-wrap gap-1.5">
            {run.availableActions.map((action, i) => (
              <span 
                key={i} 
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] border transition-all",
                  action.code === "Legal Review" || action.code.includes("Review")
                    ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                    : action.code.includes("Version")
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-muted/50 text-muted-foreground border-border"
                )}
              >
                {action.displayText || action.workflowCommandName || action.code}
              </span>
            ))}
          </div>
        </div>
      )}

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

      {/* ── Rich Details Panel ── */}
      {hasDetails && detailsOpen && (
        <div className="border-t border-border/20 bg-muted/5">

          {/* Versions section */}
          {(run.versions?.length ?? 0) > 0 && (
            <div className="px-4 py-3 border-b border-border/20">
              <div className="flex items-center gap-1.5 mb-2">
                <FileText size={11} className="text-emerald-400" />
                <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
                  Versions ({run.versions!.length})
                </span>
              </div>
              <div className="space-y-1.5">
                {run.versions!.map((v) => (
                  <div key={v.versionId} className={cn(
                    "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border",
                    v.versionId === run.generatedVersionId
                      ? "bg-emerald-500/8 border-emerald-500/20"
                      : "bg-muted/20 border-border/50"
                  )}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-medium text-foreground truncate">
                          {v.fileName || `Version ${v.versionId}`}
                        </span>
                        {v.versionId === run.generatedVersionId && (
                          <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-semibold uppercase">Active</span>
                        )}
                        {v.isGeneratedFromTemplate && (
                          <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/20">From Template</span>
                        )}
                        {v.isLocked && (
                          <span className="text-[8px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">Locked</span>
                        )}
                      </div>
                      {v.addedByName && (
                        <span className="text-[9px] text-muted-foreground">by {v.addedByName}</span>
                      )}
                      {/* Collaborators on this version */}
                      {(v.collaborators?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {v.collaborators!.map((c, ci) => (
                            <span key={ci} className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400" title={c.email || undefined}>
                              <Users size={7} /> {c.fullName || c.email || `User #${c.userId}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => onPreviewVersion(v.versionId, v.fileName ?? `version-${v.versionId}.pdf`)}
                        className="flex items-center gap-1 px-1.5 py-1 rounded text-[9px] bg-muted/50 hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-400 border border-border hover:border-emerald-500/30 transition-all"
                        title="Preview"
                      >
                        <Eye size={9} />
                      </button>
                      <a
                        href={`https://${newCloudApi}/api/${tenant}/version/${v.versionId}/download?format=1&FromPreviewPage=false&IncludeComments=false&Token=${token}`}
                        target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 px-1.5 py-1 rounded text-[9px] bg-muted/50 hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-400 border border-border hover:border-emerald-500/30 transition-all"
                        title="Download PDF"
                      >
                        <Download size={9} /> PDF
                      </a>
                      <a
                        href={`https://${newCloudApi}/api/${tenant}/version/${v.versionId}/download?format=0&FromPreviewPage=false&IncludeComments=false&Token=${token}`}
                        target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 px-1.5 py-1 rounded text-[9px] bg-muted/50 hover:bg-blue-500/10 text-muted-foreground hover:text-blue-400 border border-border hover:border-blue-500/30 transition-all"
                        title="Download DOCX"
                      >
                        <Download size={9} /> DOCX
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* People: Assignees + Approvals + Signatories */}
          <div className="px-4 py-3 border-b border-border/20 grid grid-cols-1 gap-3 sm:grid-cols-3">

            {/* Assignees */}
            <div>
              <div className="flex items-center gap-1 mb-1.5">
                <Users size={10} className="text-indigo-400" />
                <span className="text-[9px] font-semibold text-indigo-400 uppercase tracking-wider">Assignees</span>
              </div>
              {(run.contractAssignees?.length ?? 0) > 0 ? (
                <div className="space-y-1">
                  {run.contractAssignees!.map((a, i) => (
                    <div key={i} className={cn(
                      "flex items-center gap-1.5 px-2 py-1 rounded border text-[10px]",
                      a.isPrimary ? "bg-indigo-500/8 border-indigo-500/20 text-indigo-300" : "bg-muted/20 border-border/50 text-muted-foreground"
                    )}>
                      <span className="flex-1 truncate">{a.userName || `User #${a.userId}`}</span>
                      {a.isPrimary && <span className="text-[7px] text-indigo-400/70 font-bold">PRIMARY</span>}
                    </div>
                  ))}
                </div>
              ) : <span className="text-[10px] text-muted-foreground/40">None</span>}
            </div>

            {/* Approvals */}
            <div>
              <div className="flex items-center gap-1 mb-1.5">
                <Shield size={10} className="text-amber-400" />
                <span className="text-[9px] font-semibold text-amber-400 uppercase tracking-wider">Approvals</span>
              </div>
              {(run.approvals?.length ?? 0) > 0 ? (
                <div className="space-y-1">
                  {run.approvals!.map((a, i) => (
                    <div key={i} className={cn(
                      "px-2 py-1 rounded border text-[10px]",
                      a.status === "Approved" ? "bg-emerald-500/8 border-emerald-500/20" :
                      a.status === "Rejected" ? "bg-red-500/8 border-red-500/20" :
                      "bg-amber-500/8 border-amber-500/20"
                    )} title={a.condition || undefined}>
                      <div className="flex items-center justify-between gap-1">
                        <span className={cn("truncate",
                          a.status === "Approved" ? "text-emerald-400" :
                          a.status === "Rejected" ? "text-red-400" : "text-amber-400"
                        )}>{a.approverName}</span>
                        <span className={cn("text-[8px] font-bold flex-shrink-0",
                          a.status === "Approved" ? "text-emerald-400" :
                          a.status === "Rejected" ? "text-red-400" : "text-amber-400/70"
                        )}>{a.status.toUpperCase()}</span>
                      </div>
                      {a.approverRole && <div className="text-[9px] opacity-50 truncate">{a.approverRole}</div>}
                    </div>
                  ))}
                </div>
              ) : <span className="text-[10px] text-emerald-400/60">No approvals required</span>}
            </div>

            {/* Signatories (collaborators) */}
            <div>
              <div className="flex items-center gap-1 mb-1.5">
                <Users size={10} className="text-purple-400" />
                <span className="text-[9px] font-semibold text-purple-400 uppercase tracking-wider">Signatories</span>
              </div>
              {allSignatories.length > 0 ? (
                <div className="space-y-1">
                  {allSignatories.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded border border-purple-500/20 bg-purple-500/8 text-[10px] text-purple-300">
                      <span className="flex-1 truncate">{s.fullName || s.email || `User #${s.userId}`}</span>
                      {s.email && <span className="text-[8px] opacity-40 truncate">{s.email}</span>}
                    </div>
                  ))}
                </div>
              ) : <span className="text-[10px] text-muted-foreground/40">None assigned</span>}
            </div>
          </div>

          {/* Context: Clients, Parties, Requester */}
          <div className="px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {run.requesterName && (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">By</span>
                <span className="text-[10px] text-foreground/70">{run.requesterName}</span>
              </div>
            )}
            {(run.contractClients?.length ?? 0) > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Clients</span>
                <div className="flex gap-1">
                  {run.contractClients!.map((c, i) => (
                    <span key={i} className={cn(
                      "inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border",
                      c.isPrimary ? "bg-amber-500/10 border-amber-500/25 text-amber-400" : "bg-muted/30 border-border text-muted-foreground"
                    )}>
                      {c.clientName ?? `#${c.clientId}`}
                      {c.isPrimary && <span className="text-[7px]">★</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {(run.contractParties?.length ?? 0) > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Parties</span>
                <div className="flex gap-1">
                  {run.contractParties!.map((p, i) => (
                    <span key={i} className={cn(
                      "inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border",
                      p.isPrimary ? "bg-purple-500/10 border-purple-500/25 text-purple-400" : "bg-muted/30 border-border text-muted-foreground"
                    )}>
                      {p.name ?? `#${p.legalPartyId}`}
                      {p.isPrimary && <span className="text-[7px]">★</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
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
  const { tenant, username, cloudInstance, newCloudApi, token } = useAuthStore();

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
  // Document preview dialog
  const [previewVersion, setPreviewVersion] = useState<{ versionId: number; fileName: string } | null>(null);
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
      return listApplicationTypes(clients!.oldProd, tenant, username);
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

  // Auto-select when exactly one template available; clear when app type changes
  useEffect(() => {
    if (templates.length === 1) {
      setSelTemplateId(templates[0].contractTemplateId || templates[0].id);
    } else if (templates.length === 0) {
      setSelTemplateId(null);
    }
    // When multiple templates: keep selTemplateId as "global fallback" (can be null = each run picks)
  }, [templates.length]);

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
        
        // Fetch official Record ID (REC-XXXXX) immediately after create/update
        let initialRecordId: string | undefined;
        try {
          const initDetail = await getContractDetail(clients.newCloud, tenant, requestId);
          initialRecordId = (initDetail as any)?.recordId ?? (initDetail as any)?.recordID;
        } catch (e) {
          console.error("Initial detail fetch failed", e);
        }

        patchStep(run.id, "create", { 
          status: "pass", 
          result: `Created REQ-${requestId}${initialRecordId ? ` (${initialRecordId})` : ""}`, 
          durationMs: Date.now() - t0 
        });
        patchRun(run.id, { requestId, recordId: initialRecordId });
      }

      // Step 2: Version Generation + History
      // Explicitly trigger document generation via API, then fetch version history.
      const effectiveTemplateId = latestRun.selectedTemplateId ?? latestRun.templateId;
      patchStep(run.id, "version", { status: "running" });
      const tg = Date.now();

      if (effectiveTemplateId) {
        // Step 2a: Document Generation via Official Questionnaire API
        // Spec Page 182 & 193
        try {
          const qData = await getQuestionnaire(clients.oldProd, tenant, {
            contractTemplateId: effectiveTemplateId,
            applicationTypeId: selAppTypeId!,
            requestorUsername: username,
          });

          // Map our run-specific field values into the questionnaire schema
          if (qData && qData.fields) {
            qData.fields.forEach((f: any) => {
              // Priority mapping: ctgFieldName (F123), backendTag (123), fieldId
              const tagId = f.backendTag || f.fieldId || (f.ctgFieldName ? f.ctgFieldName.slice(1) : null);
              const ourVal = latestRun.fieldValues[String(tagId)];
              if (ourVal) {
                f.value = ourVal;
              } else if (f.mandatory && !f.value) {
                f.value = "Auto Test Value";
              }
            });
          }

          await submitQuestionnaire(clients.oldProd, tenant, {
            ApplicationTypeId: selAppTypeId!,
            ContractTemplateId: effectiveTemplateId,
            RequestId: Number(requestId),
            IsAI: false,
            TemplateJson: JSON.stringify(qData),
            requestorUsername: username,
          });

          await new Promise(r => setTimeout(r, 1500)); // Optimized wait
        } catch (err) {
          console.error("Document generation (Questionnaire) failed", err);
          // Non-blocking for history check
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // Step 2b: Fetch & Polling for Version History
      // Polling up to 5 times with 2s delay to balance speed and reliability
      let allVersions: VersionRecord[] = [];
      let pollCount = 0;
      const maxPolls = 10; // Increased to give more time for generation

      while (pollCount < maxPolls) {
        try {
          console.log("[DEBUG] Fetching versions from Snapshot API for REQ-" + requestId);
          const vhRes = await clients.oldProd.get(
            `/api/${tenant}/v1/snapshot/versions`,
            { params: { requestId, requestorUsername: username } }
          );
          
          console.log("[DEBUG] Snapshot Versions raw data:", JSON.stringify(vhRes.data, null, 2));
          
          const raw: any[] = Array.isArray(vhRes.data) ? vhRes.data : (Array.isArray(vhRes.data?.data) ? vhRes.data.data : []);

          allVersions = raw.map((v: any, index: number) => {
            const vid = Number(v.versionId ?? v.id ?? 0);
            const finalVid = vid > 0 ? vid : (index === 0 ? Number(requestId) : (index + 1));
            const fname = v.fileName ?? v.name ?? null;

            return {
              versionId: finalVid,
              collaborationDocumentId: vid,
              url: v.url ?? null,
              fileName: fname || `Version ${v.versionNumber || (index + 1)}`,
              versionNumber: v.versionNumber ?? null,
              isGeneratedFromTemplate: true,
              isLocked: !!v.isLocked,
              isPdf: fname?.toLowerCase().endsWith('.pdf') ?? false,
              isDocx: fname?.toLowerCase().endsWith('.docx') ?? true,
              addedByName: v.lastModifiedBy ?? v.addedByName ?? null,
              addedOn: v.lastModifiedOn ?? v.addedOn ?? null,
              collaborators: [],
            };
          });

          if (allVersions.length > 0) {
            updateRun({ id: run.id, versions: allVersions });
            break;
          }
        } catch (e) {
          console.warn("Snapshot version polling error", e);
        }

        pollCount++;
        if (pollCount < maxPolls) await new Promise(r => setTimeout(r, 1200)); // Optimized polling interval
      }

      // Step 3: Fetch Available Actions
      if (requestId) {
        try {
          const actsRes = await clients.oldProd.get(`/api/${tenant}/v1/snapshot/${requestId}/available-actions`, {
            params: { requestorUsername: username, skipCollaborationActions: true }
          });
          const acts = Array.isArray(actsRes.data) ? actsRes.data : [];
          patchRun(run.id, { availableActions: acts });
        } catch (e) {
          console.warn("Failed to fetch available actions", e);
        }
      }

      if (allVersions.length > 0) {
        // Pick the best version for single-doc preview
        const primary = allVersions.find(v => v.isGeneratedFromTemplate) ?? allVersions[0];
        patchRun(run.id, {
          generatedVersionId: primary.versionId,
          generatedFileName: primary.fileName ?? `version-${primary.versionId}`,
          versions: allVersions,
        });
        patchStep(run.id, "version", {
          status: "pass",
          result: `${allVersions.length} version${allVersions.length !== 1 ? "s" : ""} · ${primary.fileName ?? `v${primary.versionId}`}`,
          durationMs: Date.now() - tg,
        });
      } else {
        patchRun(run.id, { versions: [] });
        patchStep(run.id, "version", {
          status: effectiveTemplateId ? "warn" : "idle",
          result: effectiveTemplateId ? "No version generated (backend delay?)" : "No template selected",
          durationMs: Date.now() - tg,
        });
      }

      // Step 3: Fetch & Verify + action-taken
      patchStep(run.id, "fetch", { status: "running" });
      const t1 = Date.now();
      const [detail, actionTaken] = await Promise.all([
        getContractDetail(clients.newCloud, tenant, requestId!),
        clients.newCloud.get(`/api/${tenant}/contract-request/action-taken/${requestId}`)
          .then(r => Boolean(r.data?.data ?? r.data)).catch(() => false),
      ]);
      const stage = (detail as any)?.workflowStage ?? (detail as any)?.currentStage ?? "Unknown";
      patchStep(run.id, "fetch", { status: "pass", result: `Stage: ${stage}`, durationMs: Date.now() - t1 });
      patchRun(run.id, {
        currentStage: stage,
        recordId: (detail as any)?.recordId ?? (detail as any)?.recordID ?? undefined,
        actionTaken,
        contractAssignees: (detail.assignees ?? []) as AssigneeRef[],
        contractClients: (detail.clients ?? []) as ClientRef[],
        contractParties: (detail.legalParties ?? []) as LegalPartyRef[],
        requesterName: (detail.requesterUser as any)?.fullName ?? (detail.requesterUser as any)?.userName ?? undefined,
      });

      // Step 4: Approvals
      patchStep(run.id, "approvals", { status: "running" });
      const t2 = Date.now();
      try {
        const appRes: any = await getPreExecutionApprovals(clients.newCloud, tenant, requestId!);
        // Handle Leah double-wrap and varying casing
        const inner = appRes?.data?.data ?? appRes?.data ?? appRes;
        const rawList = inner?.approvals ?? appRes?.approvals ?? [];
        const list: PreExecutionApproval[] = (Array.isArray(rawList) ? rawList : []).map((a: any) => ({
          approvalId:     Number(a.approvalId ?? 0),
          approverName:   String(a.approvername ?? a.approverName ?? a.fullName ?? "Unknown Approver"),
          approverUserId: Number(a.approverUserId ?? a.userId ?? 0),
          approverRole:   String(a.approverrole ?? a.approverRole ?? ""),
          status:         (a.status ?? "Pending") as any,
          condition:      String(a.condition ?? ""),
          actionedOn:     a.actionedOn ?? null,
          comments:       a.comments ?? null,
        }));
        const count = list.length;
        patchRun(run.id, { approvals: list });
        patchStep(run.id, "approvals", {
          status: count > 0 ? "warn" : "pass",
          result: count > 0 ? `${count} approval trigger${count !== 1 ? "s" : ""}` : "No approvals required",
          durationMs: Date.now() - t2,
        });
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

              {/* Template — smart selection */}
              {selAppTypeId && (
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                    Template
                    {!templatesLoading && templates.length === 1 && (
                      <span className="ml-1.5 normal-case font-normal text-emerald-400">(auto-selected)</span>
                    )}
                    {!templatesLoading && templates.length > 1 && (
                      <span className="ml-1.5 normal-case font-normal text-amber-400">({templates.length} available — pick per run)</span>
                    )}
                    {!templatesLoading && templates.length === 0 && (
                      <span className="ml-1.5 normal-case font-normal text-muted-foreground">(none for this type)</span>
                    )}
                  </label>

                  {templatesLoading ? (
                    <div className="h-9 flex items-center px-2 text-xs text-muted-foreground border border-border rounded-md">
                      <Loader2 size={11} className="animate-spin mr-1.5" /> Loading templates…
                    </div>
                  ) : templates.length === 0 ? (
                    <div className="h-9 flex items-center px-2 text-xs text-muted-foreground border border-border/50 rounded-md bg-muted/20">
                      No templates — contract created without document
                    </div>
                  ) : templates.length === 1 ? (
                    /* Auto-select the only template — no picker needed */
                    <div className="h-9 flex items-center gap-2 px-2.5 text-xs border border-emerald-500/30 bg-emerald-500/5 rounded-md">
                      <CheckCircle2 size={11} className="text-emerald-400 flex-shrink-0" />
                      <span className="text-foreground font-medium truncate">
                        {templates[0].contractTemplateName || templates[0].name}
                      </span>
                    </div>
                  ) : (
                    /* Multiple templates — global fallback only; per-run picker shown in RunCard */
                    <select
                      value={selTemplateId ?? ""}
                      onChange={e => setSelTemplateId(e.target.value ? Number(e.target.value) : null)}
                      className="w-full h-9 text-sm bg-background border border-amber-500/30 rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                    >
                      <option value="">— Each run picks its own template —</option>
                      {templates.map(t => (
                        <option key={t.contractTemplateId || t.id} value={t.contractTemplateId || t.id}>
                          {t.contractTemplateName || t.name}
                        </option>
                      ))}
                    </select>
                  )}
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
              newCloudApi={newCloudApi || ""}
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
              onPreviewDoc={() => run.generatedVersionId && setPreviewVersion({ versionId: run.generatedVersionId, fileName: run.generatedFileName ?? "" })}
              onPreviewVersion={(versionId, fileName) => setPreviewVersion({ versionId, fileName })}
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

    {/* ── Document preview dialog ── */}
    {previewVersion && (
      <FilePreviewDialog
        versionId={previewVersion.versionId}
        fileName={previewVersion.fileName}
        tenant={tenant}
        newCloudApi={newCloudApi}
        token={token ?? ""}
        onClose={() => setPreviewVersion(null)}
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
