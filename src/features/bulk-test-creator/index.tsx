import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FlaskConical, CheckCircle2, Trash2, Play, AlertCircle, Download, Import,
  XCircle, Loader2, Plus, Edit2, X, Search, Clock,
  Copy, ExternalLink, CheckSquare, Square, AlertTriangle, RotateCcw, Eye,
  FileText, Users, Shield, GitBranch, ChevronDown, ChevronUp, Settings as SettingsIcon, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { PageHeader, Spinner } from "@/components/shared/PageHeader";
import { useApiClients } from "@/hooks/useApiClients";
import { useAuthStore } from "@/store/authStore";
import { QK, cn } from "@/lib/utils";
import { getIntakeFormFields, createContract, getContractDetail, updateContract, buildUpdatePayload, getQuestionnaire, submitQuestionnaire } from "@/api/contractRequest";
import { getContractTemplates } from "@/api/applicationTypes";
import { getSnapshotApprovals } from "@/api/approval";
import { listUsers } from "@/api/users";
import { listFieldDefinitions } from "@/api/metadata";
import { getESignStatus, sendESignRequest } from "@/api/esign";
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
  recordId?: number | string;
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
  // eSign
  includeSignature?: boolean;
  esignSignatories?: ESignRecipient[];
  esignSubject?: string;
  esignMessage?: string;
  esignStatus?: any; // ESignStatusResponse
}

interface RecentPreset {
  id: string;
  label: string;
  ids: number[];
  timestamp: number;
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
    { id: "esign",     label: "E-Signature",      status: "idle" },
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
  onSaveAndRerun, onViewContract, onPreviewDoc, onPreviewVersion, onESignTest, isRunningAll,
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
  onESignTest: () => void;
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
      "glass-panel rounded-2xl overflow-hidden transition-all duration-500 animate-in fade-in zoom-in-95 leading-relaxed group",
      isDone ? "border-emerald-500/20 shadow-lg shadow-emerald-500/5 bg-emerald-500/[0.02]" :
      isErr ? "border-red-500/20 shadow-lg shadow-red-500/5 bg-red-500/[0.02]" :
      isRun ? "border-blue-500/30 shadow-2xl shadow-blue-500/10 bg-blue-500/[0.04] ring-1 ring-blue-500/10" :
      "border-white/5 bg-card/10 hover:border-white/10"
    )}>

      {/* ── Header ── */}
      <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4 bg-white/[0.01] border-b border-white/[0.03]">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className={cn(
            "status-ring w-10 h-10 flex-shrink-0 text-sm font-black shadow-lg",
            isDone ? "status-ring-done text-emerald-500 bg-emerald-500/10" :
            isErr ? "status-ring-error text-red-500 bg-red-500/10" :
            isRun ? "status-ring-running text-blue-500 bg-blue-500/10" :
            "text-muted-foreground/60 bg-white/5"
          )}>
            {isDone ? <CheckCircle2 size={18} /> : isErr ? <AlertCircle size={18} /> :
             isRun ? <Loader2 size={18} className="animate-spin" /> : <span className="text-xs">{run.index}</span>}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-lg font-black tracking-tight text-foreground/90">Run #{run.index}</span>
              {run.requestId && (
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-black/40 border border-white/5 shadow-inner">
                  <span className="text-[10px] uppercase font-black px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-md tracking-widest border border-blue-500/10">REQ-{run.requestId}</span>
                  {run.recordId && (
                    <span className="text-[10px] uppercase font-black px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-md tracking-widest border border-emerald-500/10">REC-{run.recordId}</span>
                  )}
                  <div className="flex items-center gap-2 px-2 border-l border-white/10 ml-1">
                    <button onClick={() => { navigator.clipboard.writeText(String(run.requestId)); toast.success("ID Copied"); }} className="text-muted-foreground hover:text-white transition-colors" title="Copy ID"><Copy size={11} /></button>
                    <a href={`https://${cloudInstance}/${tenant ? (tenant.charAt(0).toUpperCase() + tenant.slice(1)) : ""}/#/contract-snapshot/${run.requestId}`} target="_blank" rel="noreferrer" className="text-blue-400/80 hover:text-blue-300 transition-colors" title="Open Dashboard"><ExternalLink size={11} /></a>
                  </div>
                </div>
              )}
              {run.currentStage && (
                <span className={cn(
                  "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.1em] border shadow-sm",
                  run.currentStage.toLowerCase().includes("complete") ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                  run.currentStage.toLowerCase().includes("negotiat") ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                  run.currentStage.toLowerCase().includes("approv") ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                  "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
                )}>
                  {run.currentStage}
                </span>
              )}
            </div>
            <div className="text-[10px] font-black text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2">
              <span className="flex items-center gap-1 uppercase tracking-widest"><Layers size={10} /> {run.appTypeName}</span>
              {(run.templateName || run.selectedTemplateName) && (
                <span className="text-amber-400/60 truncate max-w-[150px] flex items-center gap-1">
                  <div className="w-1 h-1 rounded-full bg-white/10" />
                  <FileText size={10} /> {run.selectedTemplateName || run.templateName}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:flex-shrink-0">
          <div className="flex items-center gap-1.5 h-8 bg-black/20 p-1 rounded-xl border border-white/5 shadow-inner">
            {hasDetails && (
              <button
                onClick={() => setDetailsOpen(o => !o)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-all"
                title={detailsOpen ? "Collapse details" : "Expand details"}
              >
                {detailsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            )}
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-[11px] font-bold px-3 rounded-lg hover:bg-white/10" onClick={onToggleEdit}>
              <Edit2 size={12} className={cn("transition-transform", run.editOpen && "rotate-12")} /> {run.editOpen ? "Close" : "Edit"}
            </Button>
          </div>

          <div className="flex items-center gap-2 h-8">
            {run.requestId && isDone && (
              <Button 
                size="sm" variant="outline" 
                className="h-8 gap-1.5 text-[11px] font-bold px-3 text-blue-400 border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/40 rounded-xl transition-all shadow-sm" 
                onClick={onViewContract}
              >
                <Eye size={12} /> View
              </Button>
            )}
            {isDone && (
              <Button 
                size="sm" variant="outline" 
                className="h-8 gap-1.5 text-[11px] font-bold px-3 text-emerald-400 border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 hover:border-emerald-500/40 rounded-xl transition-all shadow-sm disabled:opacity-30" 
                onClick={onPreviewDoc} 
                disabled={!run.generatedVersionId}
              >
                <FileText size={12} /> Preview
              </Button>
            )}
          </div>

          {!isRunningAll && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className={cn(
                  "h-8 gap-2 text-[11px] font-black uppercase tracking-widest px-4 rounded-xl transition-all shadow-lg active:scale-95", 
                  isDone || isErr ? "bg-white/5 hover:bg-white/10 text-foreground border border-white/10" : "bg-amber-500 hover:bg-amber-400 text-black shadow-amber-500/20"
                )}
                variant={isDone || isErr ? "outline" : "default"}
                onClick={onRun} disabled={isRun}
              >
                {isRun ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} className={cn(isDone || isErr ? "" : "animate-pulse-subtle")} />}
                {run.requestId ? "Rerun" : "Run Test"}
              </Button>
              
              {run.requestId && isDone && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-2 text-[11px] font-black uppercase tracking-widest px-4 text-purple-400 border-purple-500/20 bg-purple-500/5 hover:bg-purple-500/10 hover:border-purple-500/40 rounded-xl transition-all shadow-md shadow-purple-500/5"
                  onClick={onESignTest}
                  disabled={isRun}
                  title="Manual Signature Request"
                >
                  <Users size={12} /> Sign
                </Button>
              )}
            </div>
          )}
          <button onClick={onDelete} className="p-2 rounded-xl text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-all ml-auto">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Available Actions Section */}
      {run.availableActions && run.availableActions.length > 0 && (
        <div className="px-5 pb-4 pt-1 border-t border-white/[0.03]">
          <div className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
            <Shield size={10} className="text-blue-500/50" /> System Commands
          </div>
          <div className="flex flex-wrap gap-2">
            {run.availableActions.map((action, i) => (
              <span 
                key={i} 
                className={cn(
                  "px-3 py-1 rounded-lg text-[10px] font-bold border transition-all duration-300 cursor-default",
                  action.code === "Legal Review" || action.code.includes("Review")
                    ? "bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-sm shadow-blue-500/5"
                    : action.code.includes("Version")
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-sm shadow-emerald-500/5"
                    : "bg-white/5 text-muted-foreground/70 border-white/5 hover:bg-white/10"
                )}
              >
                {action.displayText || action.workflowCommandName || action.code}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Execution Timeline ── */}
      <div className="px-5 py-5 border-t border-white/[0.03] bg-black/10">
        <div className="relative flex items-center justify-between gap-1">
          {/* Connecting Line Backdrop */}
          <div className="absolute left-6 right-6 h-0.5 bg-white/5 top-1/2 -translate-y-1/2" />
          
          {run.steps.map((s, idx) => {
            const isActive = s.status === "running";
            const isDoneStep = s.status === "pass" || s.status === "warn" || s.status === "fail";
            const color = s.status === "pass" ? "emerald" : s.status === "fail" ? "red" : s.status === "warn" ? "amber" : s.status === "running" ? "blue" : "muted";

            return (
              <div key={s.id} className="relative z-10 flex flex-col items-center group/step flex-1">
                {/* Connector line (inside item) */}
                {idx < run.steps.length - 1 && (
                   <div className={cn(
                     "absolute left-1/2 w-full h-0.5 top-1/2 -translate-y-1/2 transition-colors duration-500",
                     isDoneStep ? `bg-${color}-500/30` : "bg-transparent"
                   )} />
                )}
                
                {/* Node */}
                <div className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all duration-500 shadow-md",
                  s.status === "pass" ? "bg-emerald-500/20 border-emerald-500 text-emerald-400" :
                  s.status === "fail" ? "bg-red-500/20 border-red-500 text-red-400" :
                  s.status === "warn" ? "bg-amber-500/20 border-amber-500 text-amber-400" :
                  s.status === "running" ? "bg-blue-500/20 border-blue-500 text-blue-400 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.3)]" :
                  "bg-white/5 border-white/10 text-white/20"
                )}>
                  {s.status === "pass" ? <CheckCircle2 size={12} /> : 
                   s.status === "fail" ? <XCircle size={12} /> :
                   s.status === "warn" ? <AlertTriangle size={12} /> :
                   s.status === "running" ? <Loader2 size={12} className="animate-spin" /> : 
                   <div className="w-1.5 h-1.5 rounded-full bg-current" />}
                </div>

                {/* Info Tooltip-like label */}
                <div className="absolute top-8 flex flex-col items-center gap-0.5 opacity-60 group-hover/step:opacity-100 transition-opacity whitespace-nowrap">
                   <span className={cn(
                     "text-[9px] font-black uppercase tracking-tighter",
                     s.status === "running" ? "text-blue-400" : "text-muted-foreground"
                   )}>{s.label}</span>
                   {s.durationMs && <span className="text-[8px] font-mono opacity-50">{s.durationMs}ms</span>}
                </div>
              </div>
            );
          })}
        </div>
        {/* Spacer for the labels below */}
        <div className="h-8" />
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
            <div className="px-5 py-4 border-b border-white/[0.03]">
              <div className="flex items-center gap-2 mb-3">
                <FileText size={12} className="text-emerald-400" />
                <span className="text-label !text-emerald-400/80">
                  Document Versions ({run.versions!.length})
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {run.versions!.map((v) => (
                  <div key={v.versionId} className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all hover:bg-white/[0.02]",
                    v.versionId === run.generatedVersionId
                      ? "bg-emerald-500/[0.05] border-emerald-500/20 shadow-sm"
                      : "bg-white/[0.01] border-white/5"
                  )}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-black text-foreground/90 truncate max-w-[140px]">
                          {v.fileName || `Version ${v.versionId}`}
                        </span>
                        {v.versionId === run.generatedVersionId && (
                          <span className="text-[7px] font-black px-1.5 py-0.5 rounded-sm bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 uppercase tracking-tighter">Active</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {v.addedByName && (
                          <span className="text-[9px] text-muted-foreground/50 font-medium">by {v.addedByName}</span>
                        )}
                        {v.isGeneratedFromTemplate && (
                          <span className="text-[8px] font-bold text-blue-400/60 uppercase tracking-tighter">· AI Template</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onPreviewVersion(v.versionId, v.fileName ?? `version-${v.versionId}.pdf`)}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground/60 hover:text-white transition-all border border-white/5"
                        title="Preview"
                      >
                        <Eye size={11} />
                      </button>
                      <a
                        href={`https://${newCloudApi}/api/${tenant}/version/${v.versionId}/download?format=1&FromPreviewPage=false&IncludeComments=false&Token=${token}`}
                        target="_blank" rel="noreferrer"
                        className="p-1.5 rounded-lg bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-500/60 hover:text-emerald-400 transition-all border border-emerald-500/10"
                        title="Download PDF"
                      >
                        <Download size={11} />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* People: Assignees + Approvals + Signatories */}
          <div className="px-5 py-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 border-b border-white/[0.03]">

            {/* Assignees */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Users size={12} className="text-indigo-400" />
                <span className="text-label !text-indigo-400/80">Assignees</span>
              </div>
              {(run.contractAssignees?.length ?? 0) > 0 ? (
                <div className="space-y-2">
                  {run.contractAssignees!.map((a, i) => (
                    <div key={i} className={cn(
                      "flex items-center justify-between gap-3 px-3 py-2 rounded-xl border transition-all text-[11px] font-medium shadow-sm",
                      a.isPrimary ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-200" : "bg-white/[0.02] border-white/5 text-muted-foreground/80 hover:bg-white/[0.05]"
                    )}>
                      <span className="truncate flex-1">{a.userName || `User #${a.userId}`}</span>
                      {a.isPrimary && <span className="text-[8px] font-black text-indigo-400 bg-indigo-500/20 px-2 py-0.5 rounded-full shadow-inner border border-indigo-500/20">PRIMARY</span>}
                    </div>
                  ))}
                </div>
              ) : <div className="text-[11px] text-muted-foreground/30 italic px-1 font-medium">No assignees found</div>}
            </div>

            {/* Approvals */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Shield size={12} className="text-amber-400" />
                <span className="text-label !text-amber-400/80">Approvals</span>
              </div>
              {(run.approvals?.length ?? 0) > 0 ? (
                <div className="space-y-2">
                  {run.approvals!.map((a, i) => (
                    <div key={i} className={cn(
                      "px-3 py-2 rounded-xl border transition-all text-[11px] shadow-sm",
                      a.isApproved ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-200" :
                      (a.status as string).toLowerCase() === "rejected" ? "bg-red-500/10 border-red-500/20 text-red-200" :
                      "bg-amber-500/10 border-amber-500/20 text-amber-200"
                    )} title={a.condition || undefined}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-bold flex-1 text-foreground">{a.approverName}</span>
                        <span className={cn("text-[8px] font-black px-2 py-0.5 rounded-full shadow-inner border",
                          a.isApproved ? "bg-emerald-500/30 text-emerald-300 border-emerald-500/30" :
                          (a.status as string).toLowerCase() === "rejected" ? "bg-red-500/30 text-red-300 border-red-500/30" : "bg-amber-500/30 text-amber-300 border-amber-500/30"
                        )}>{(a.statusName || a.status).toUpperCase()}</span>
                      </div>
                      <div className="text-[9px] text-muted-foreground/60 font-mono mt-1 flex items-center gap-1.5 uppercase truncate tracking-tight">{a.approverRole}</div>
                    </div>
                  ))}
                </div>
              ) : <div className="text-[11px] text-muted-foreground/30 italic px-1 font-medium">Workflow bypass allowed</div>}
            </div>

            {/* Signatories (E-Signature status) */}
            <div className="space-y-3 md:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-2">
                <Users size={12} className="text-purple-400/60" />
                <span className="text-[10px] font-black text-purple-400/60 uppercase tracking-[0.1em]">Signatories</span>
              </div>
              {run.esignStatus ? (
                <div className="space-y-2">
                  {run.esignStatus.recipientStatus.map((s: any, i: number) => (
                    <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-purple-500/20 bg-purple-500/[0.05] text-[11px] shadow-sm hover:bg-purple-500/[0.08] transition-all">
                      <div className="min-w-0 pr-2">
                        <div className="font-black text-foreground/90 truncate">{s.name}</div>
                        <div className="text-[9px] text-muted-foreground/60 truncate font-medium">{s.email}</div>
                      </div>
                      <span className={cn(
                        "text-[8px] font-black px-2 py-0.5 rounded-full shadow-inner border border-purple-500/20 whitespace-nowrap",
                        s.status === "Signed" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/20" :
                        s.status === "Declined" ? "bg-red-500/20 text-red-400 border-red-500/20" :
                        "bg-purple-500/20 text-purple-300"
                      )}>{s.status?.toUpperCase() || "PENDING"}</span>
                    </div>
                  ))}
                </div>
              ) : allSignatories.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {allSignatories.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/5 bg-white/[0.03] text-[10px] font-bold text-muted-foreground/80">
                      <Users size={10} className="text-purple-400/40" />
                      <span className="truncate">{s.fullName || s.email || `User #${s.userId}`}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="text-[11px] text-muted-foreground/30 italic px-1 font-medium">None assigned</div>}
            </div>
          </div>

          {/* Context: Clients, Parties, Requester */}
          <div className="px-5 py-3 flex flex-wrap items-center gap-x-8 gap-y-3 bg-white/[0.01] border-t border-white/[0.03]">
            {run.requesterName && (
              <div className="flex items-center gap-2">
                <span className="text-label !text-white/40">Created By</span>
                <span className="text-[11px] font-black text-foreground">{run.requesterName}</span>
              </div>
            )}
            {(run.contractClients?.length ?? 0) > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-label !text-white/40">Clients</span>
                <div className="flex gap-2">
                  {run.contractClients!.map((c, i) => {
                    const mappedName = liveClients.find(lc => lc.id === c.clientId)?.name;
                    return (
                      <span key={i} className={cn(
                        "inline-flex items-center gap-1.5 text-[10px] font-black px-2.5 py-1 rounded-lg border shadow-sm",
                        c.isPrimary ? "bg-amber-500/10 border-amber-500/20 text-amber-500/80" : "bg-white/5 border-white/5 text-muted-foreground/60"
                      )}>
                        {mappedName || c.clientName || `#${c.clientId}`}
                        {c.isPrimary && <div className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            {(run.contractParties?.length ?? 0) > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-label !text-white/40">Parties</span>
                <div className="flex gap-2">
                  {run.contractParties!.map((p, i) => (
                    <span key={i} className={cn(
                      "inline-flex items-center gap-1.5 text-[10px] font-black px-2.5 py-1 rounded-lg border shadow-sm",
                      p.isPrimary ? "bg-purple-500/10 border-purple-500/20 text-purple-500/80" : "bg-white/5 border-white/5 text-muted-foreground/60"
                    )}>
                      {p.name ?? `#${p.legalPartyId}`}
                      {p.isPrimary && <div className="w-1 h-1 rounded-full bg-purple-500 animate-pulse" />}
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
        <div className="border-t border-white/[0.03] bg-black/40 animate-in slide-in-from-top-4 duration-500">
          <div className="px-5 py-4 flex items-center justify-between border-b border-white/[0.03] bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-4 bg-primary rounded-full" />
              <span className="text-xs font-black uppercase tracking-[0.1em] text-foreground/80">Override Parameters: Run #{run.index}</span>
            </div>
            <Button size="sm" className="h-8 gap-2 text-[10px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-lg shadow-emerald-500/10" onClick={onSaveAndRerun}>
              <Play size={12} fill="currentColor" /> Save & Re-Execute
            </Button>
          </div>
          <div className="px-5 py-5 max-h-[500px] overflow-y-auto space-y-6 custom-scrollbar">

            {/* Client & Party overrides per run */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 border-b border-white/[0.03]">
              <div className="space-y-2">
                <label className="text-label block">
                  Target Client <span className="text-red-400 font-black">*</span>
                </label>
                <select
                  value={run.selectedClientId ?? ""}
                  onChange={e => onClientChange(e.target.value ? Number(e.target.value) : null)}
                  className="w-full h-9 text-xs bg-white/5 border border-white/10 rounded-xl px-3 focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground/80 transition-all hover:bg-white/[0.08]"
                >
                  <option value="">— Use Global —</option>
                  {liveClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-label block">Legal Party Overlay</label>
                <select
                  value={run.selectedPartyId ?? ""}
                  onChange={e => onPartyChange(e.target.value ? Number(e.target.value) : null)}
                  className="w-full h-9 text-xs bg-white/5 border border-white/10 rounded-xl px-3 focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground/80 transition-all hover:bg-white/[0.08]"
                >
                  <option value="">— Use Global —</option>
                  {liveParties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>

            {Object.entries(groupedForEdit).map(([section, sFields]) => (
              <div key={section} className="space-y-4">
                <div className="flex items-center gap-2">
                   <div className="h-px flex-1 bg-white/[0.03]" />
                   <p className="text-[9px] font-black text-muted-foreground/30 uppercase tracking-[0.2em]">{section || "Base Attributes"}</p>
                   <div className="h-px flex-1 bg-white/[0.03]" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                  {sFields.map(f => {
                    const id = String(f.fieldId);
                    return (
                      <div key={id} className="space-y-2 group/field">
                        <div className="flex items-center justify-between gap-2">
                           <div className="flex items-center gap-1.5 min-w-0">
                             <span className="text-[11px] font-bold text-foreground/70 truncate">{f.displayName || f.fieldName}</span>
                             {f.isRequired && <span className="text-red-500/60 font-black text-[10px]">*</span>}
                           </div>
                           <span className="text-[8px] font-black text-muted-foreground/30 uppercase tracking-tighter bg-white/5 px-1.5 py-0.5 rounded border border-white/5 opacity-0 group-hover/field:opacity-100 transition-opacity">{f.fieldType}</span>
                        </div>
                        <div className="relative">
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
  const [importInput, setImportInput] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  // eSign Setup State
  const [includeSignature, setIncludeSignature] = useState(false);
  const [signatories, setSignatories] = useState([
    { name: "Suresh Singh", email: "suresh.singh@integreon.com", order: 1 },
    { name: "Satyam Raj", email: "satyam.raj@integreon.com", order: 2 }
  ]);
  const [esignSubject, setEsignSubject] = useState("Leah CLM - Signature Request for Contract");
  const [esignMessage, setEsignMessage] = useState("<p>Hello,</p><p>Please review and sign the attached contract.</p><p>Regards,<br/>Leah Automation</p>");

  // Recent Presets History
  const [recentPresets, setRecentPresets] = useState<RecentPreset[]>(() => {
    try {
      const saved = localStorage.getItem(`btc-presets-${tenant}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem(`btc-presets-${tenant}`, JSON.stringify(recentPresets));
  }, [recentPresets, tenant]);

  const saveBatchAsPreset = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    setRecentPresets(prev => {
      const newPreset: RecentPreset = {
        id: Math.random().toString(36).slice(2, 9),
        label: new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        ids: [...new Set(ids)], // Dedupe
        timestamp: Date.now(),
      };
      return [newPreset, ...prev].slice(0, 15); // Keep last 15
    });
  }, []);


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
 
  async function handleImport() {
    if (!clients) return;
    const ids = importInput.split(/[\s,]+/).map(s => s.trim()).filter(s => s && !isNaN(Number(s)));
    if (ids.length === 0) return toast.error("Enter valid numeric Request IDs");

    setIsImporting(true);
    const toastId = toast.loading(`Importing ${ids.length} requests...`);
    
    try {
      const newRuns: TestRun[] = [];
      for (let i = 0; i < ids.length; i++) {
        const rid = Number(ids[i]);
        try {
          const detail = await getContractDetail(clients.newCloud, tenant, rid);
          const appTypeId = detail.applicationTypeId;
          const at = (appTypesRaw as any[]).find(a => a.applicationTypeId === appTypeId);
          const appTypeName = at?.applicationTypeName || (detail as any).applicationTypeName || "Imported Type";
          
          newRuns.push({
            id: `import-${rid}-${Date.now()}`,
            index: runs.length + i + 1,
            appTypeId,
            appTypeName,
            requestId: rid,
            recordId: detail.recordId ?? 0,
            status: "idle",
            steps: buildSteps().map(s => s.id === "create" ? { ...s, status: "pass", result: `Imported REQ-${rid}` } : s),
            fieldValues: {}, 
            editOpen: false,
            currentStage: (detail as any).workflowStage || (detail as any).currentStage || "Imported",
          });
        } catch (e) {
          console.error(`Failed to import REQ-${rid}`, e);
        }
      }
      
      if (newRuns.length > 0) {
        setRuns(prev => [...prev, ...newRuns]);
        setImportInput("");
        toast.success(`Successfully imported ${newRuns.length} request(s)`, { id: toastId });
      } else {
        toast.error("Failed to import any requests. Check if IDs exist.", { id: toastId });
      }
    } finally {
      setIsImporting(false);
    }
  }

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
      includeSignature,
      esignSignatories: [...signatories],
      esignSubject,
      esignMessage,
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
            patchRun(run.id, { versions: allVersions });
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
      // Fetch eSign status if possible
      let esStat = undefined;
      try {
        esStat = await getESignStatus(clients.oldProd, tenant, {
          contractId: Number(detail.id),
          requestId: requestId!,
          requestorUsername: username
        });
      } catch (e) {
        console.warn("Initial eSign status fetch failed", e);
      }

      patchStep(run.id, "fetch", { status: "pass", result: `Stage: ${stage}`, durationMs: Date.now() - t1 });
      patchRun(run.id, {
        currentStage: stage,
        recordId: (detail as any)?.recordId ?? (detail as any)?.recordID ?? undefined,
        actionTaken,
        contractAssignees: (detail.assignees ?? []) as AssigneeRef[],
        contractClients: (detail.clients ?? []) as ClientRef[],
        contractParties: (detail.legalParties ?? []) as LegalPartyRef[],
        requesterName: (detail.requesterUser as any)?.fullName ?? (detail.requesterUser as any)?.userName ?? undefined,
        esignStatus: esStat,
      });

      // Step 3.5: Automated E-Signature
      if (latestRun.includeSignature && requestId) {
        patchStep(run.id, "esign", { status: "running" });
        try {
          // We need the latest version ID to send for signature
          // Use values from local scope rather than stale latestRun
          const vId = latestRun.generatedVersionId || (allVersions.length > 0 ? (allVersions.find(v => v.isGeneratedFromTemplate) ?? allVersions[0]).versionId : undefined);
          const signatories = latestRun.esignSignatories ?? [];
          
          if (vId && signatories.length > 0) {
            await sendESignRequest(clients.oldProd, tenant, {
              RequestId: requestId,
              ContractId: Number(detail.id),
              ContractVersionId: vId,
              RequestorUsername: username,
              Recipients: signatories.map(s => ({ Name: s.name, EmailId: s.email, Order: s.order })),
              Subject: latestRun.esignSubject,
              Message: latestRun.esignMessage,
              SupportingDocumentIds: String(vId),
              documentOrder: [{ Id: vId, Type: "Contract" }]
            });
            
            // Immediately fetch status to reveal signatories
            try {
              const esRes = await getESignStatus(clients.oldProd, tenant, {
                contractId: Number(detail.id),
                requestId: requestId!,
                requestorUsername: username
              });
              patchRun(run.id, { esignStatus: esRes });
            } catch (e) {
              console.warn("Post-esign status fetch failed", e);
            }

            patchStep(run.id, "esign", { status: "pass", result: "Signature request submitted" });
          } else {
            patchStep(run.id, "esign", { status: "warn", result: vId ? "No signatories" : "No version" });
          }
        } catch (err: any) {
          patchStep(run.id, "esign", { status: "fail", result: extractApiError(err) });
        }
      }

      // Step 4: Approvals
      patchStep(run.id, "approvals", { status: "running" });
      const t2 = Date.now();
      try {
        const rawList = await getSnapshotApprovals(clients.oldProd, tenant, requestId!, username);
        const list: PreExecutionApproval[] = (Array.isArray(rawList) ? rawList : []).map((a: any) => ({
          approvalGuid:   a.approvalGuid || "",
          approvalId:     Number(a.approvalId ?? 0),
          approverName:   String(a.fullname || a.approverName || a.approvername || "Unknown Approver"),
          fullname:       a.fullname || "",
          username:       a.username || "",
          approverUserId: Number(a.assignedToId || a.approverUserId || 0),
          approverRole:   String(a.statusName || a.approverRole || ""),
          condition:      String(a.autoApprovalParentProcessCondition || ""),
          status:         a.isApproved ? "Approved" : (a.statusName === "Negotiation" ? "Pending" : "Pending"),
          statusName:     a.statusName || "Pending",
          isApproved:     !!a.isApproved,
          isAutoApproval: !!a.isAutoApproval,
          actionedOn:     a.approvalDate || null,
          comments:       a.comments || "",
        }));

        patchRun(run.id, { approvals: list });
        const hasRejected = list.some(a => (a.status as string).toLowerCase() === "rejected");
        const allApproved = list.length > 0 && list.every(a => a.isApproved);

        patchStep(run.id, "approvals", {
          status: hasRejected ? "fail" : (allApproved ? "pass" : "pass"),
          result: list.length > 0 
            ? `${list.length} approver${list.length !== 1 ? "s" : ""} · ${list[0].statusName || (allApproved ? "Approved" : "Pending")}`
            : "No active approvals",
          durationMs: Date.now() - t2,
        });
      } catch (e) {
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

  async function handleESignTest(run: TestRun) {
    if (!clients || !run.requestId) return;
    const toastId = toast.loading(`Submitting signature for REQ-${run.requestId}...`);
    try {
      const detail = await getContractDetail(clients.newCloud, tenant, run.requestId);
      const vId = run.generatedVersionId;
      const sigs = run.esignSignatories ?? (signatories.length > 0 ? signatories : []); 

      if (!vId) throw new Error("No document version identified to sign");
      if (!sigs || sigs.length === 0) throw new Error("No signatories configured");

      await sendESignRequest(clients.oldProd, tenant, {
        RequestId: run.requestId,
        ContractId: Number(detail.id),
        ContractVersionId: vId,
        RequestorUsername: username,
        Recipients: sigs.map(s => ({ Name: s.name, EmailId: s.email, Order: s.order })),
        Subject: run.esignSubject,
        Message: run.esignMessage,
        SupportingDocumentIds: String(vId),
        documentOrder: [{ Id: vId, Type: "Contract" }]
      });
      
      toast.success("Signature Request Submitted", { id: toastId });
      
      try {
        const esRes = await getESignStatus(clients.oldProd, tenant, {
          contractId: Number(detail.id),
          requestId: run.requestId,
          requestorUsername: username
        });
        patchRun(run.id, { esignStatus: esRes });
      } catch (e) {
        console.warn("Status fetch failed", e);
      }
      
    } catch (e: any) {
      toast.error(extractApiError(e), { id: toastId });
    }
  }

  async function executeAll() {
    if (runs.length === 0) return;
    abortRef.current = false;
    setIsRunningAll(true);
    
    const capturedIds: number[] = [];
    
    for (const run of runs) {
      if (abortRef.current) break;
      await executeRun(run);
      // After each run, find the updated requestId from the run reference or results
      // Since executeRun mutations might not be reflected in our local 'run' object immediately,
      // we'll rely on the fact that we can track it.
      await new Promise(r => setTimeout(r, 400));
    }
    
    // Get the very latest IDs from the current state to be safe
    setRuns(currentRuns => {
      const ids = currentRuns.map(r => r.requestId).filter(Boolean) as number[];
      if (ids.length > 0) {
        saveBatchAsPreset(ids);
      }
      return currentRuns;
    });

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
    <div className="space-y-6 animate-fade-in">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/10 via-background to-background border border-white/5 p-6 mb-4 shadow-xl">
        <div className="absolute top-0 right-0 w-80 h-80 bg-primary/10 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-purple-500/5 blur-[80px] rounded-full translate-y-1/2 -translate-x-1/4 pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-1">
            <h1 className="text-3xl font-black tracking-tighter text-foreground bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">Bulk Test Creator</h1>
            <p className="text-xs text-muted-foreground/60 max-w-xl leading-relaxed italic font-medium">
              Orchestrate high-volume contract automation suites with precision data and real-time tracking.
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            {runs.length > 0 && (
              <Button variant="outline" size="lg" className="h-12 px-6 gap-2 rounded-2xl bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 transition-all font-bold text-xs uppercase tracking-widest shadow-xl" onClick={() => exportCSV(runs)}>
                <Download size={16} /> Export Data
              </Button>
            )}
            {runs.length > 0 && !isRunningAll && (
              <Button size="lg" className="h-12 px-8 gap-2 rounded-2xl bg-primary hover:bg-primary/80 text-white font-black text-xs uppercase tracking-[0.2em] shadow-[0_0_30px_rgba(59,130,246,0.3)] hover:shadow-[0_0_40px_rgba(59,130,246,0.4)] transition-all active:scale-95" onClick={executeAll}>
                <Play size={16} fill="currentColor" /> Run Suite ({runs.length})
              </Button>
            )}
            {isRunningAll && (
              <Button size="lg" variant="destructive" className="h-12 px-8 gap-2 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-2xl active:scale-95 transition-all" onClick={() => abortRef.current = true}>
                <XCircle size={16} /> Abort Mission
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* ── LEFT SIDEBAR ── */}
        <div className="w-full lg:w-[320px] lg:flex-shrink-0 space-y-4 lg:sticky lg:top-4">

          {/* Setup card */}
          <div className="glass-panel rounded-2xl overflow-hidden border border-white/5 bg-card/30">
            <div className="px-4 py-3 border-b border-white/5 bg-white/5 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold tracking-tight">Configuration</h3>
                {currentUser && (
                  <p className="text-[10px] font-black uppercase text-muted-foreground/80 mt-1 tracking-wider">
                    As <span className="text-foreground font-black">{currentUser.fullName}</span>
                  </p>
                )}
              </div>
              <SettingsIcon size={14} className="text-muted-foreground/40" />
            </div>
            <div className="p-4 space-y-3">
              {/* App type */}
              <div>
                <label className="text-label block mb-2">Application Type</label>
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
                  <label className="text-label block mb-2">
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
                <label className="text-label block mb-1.5">
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

              {/* Electronic Signature Configuration */}
              <div className="pt-2 border-t border-border/50 space-y-3">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-2">
                     <Users size={12} className="text-purple-400" />
                     <span className="text-[11px] font-semibold text-purple-400 uppercase tracking-wider">E-Signature</span>
                   </div>
                   <button 
                     onClick={() => setIncludeSignature(!includeSignature)}
                     className={cn(
                       "w-8 h-4 rounded-full relative transition-colors duration-200",
                       includeSignature ? "bg-purple-500" : "bg-muted-foreground/30"
                     )}
                   >
                     <div className={cn(
                       "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all duration-200",
                       includeSignature ? "left-4.5" : "left-0.5"
                     )} />
                   </button>
                </div>

                {includeSignature && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div>
                      <Label className="text-label mb-2 block">Email Subject</Label>
                      <Input 
                        value={esignSubject} 
                        onChange={e => setEsignSubject(e.target.value)}
                        placeholder="Enter subject..."
                        className="h-8 text-[11px] bg-background/50 border-purple-500/20 focus-visible:ring-purple-500/30"
                      />
                    </div>
                    
                    <div>
                      <Label className="text-label mb-2 block">Email Message (HTML)</Label>
                      <textarea 
                        value={esignMessage}
                        onChange={e => setEsignMessage(e.target.value)}
                        className="w-full min-h-[80px] rounded-md border border-purple-500/20 bg-background/50 px-3 py-2 text-[11px] ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus:ring-1 focus:ring-purple-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                        placeholder="Enter HTML message..."
                      />
                    </div>

                    <div className="space-y-2.5">
                      <Label className="text-[10px] text-muted-foreground uppercase block">Signatories</Label>
                    </div>
                    {signatories.map((s, idx) => (
                      <div key={idx} className="space-y-1.5 p-2 bg-muted/20 border border-border/50 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-black text-purple-400 uppercase tracking-widest">Signer {idx + 1}</span>
                        </div>
                        <Input 
                          placeholder="Full Name" 
                          value={s.name} 
                          onChange={e => {
                            const next = [...signatories];
                            next[idx].name = e.target.value;
                            setSignatories(next);
                          }}
                          className="h-7 text-[10px] bg-background border-border/50"
                        />
                        <Input 
                          placeholder="Email Address" 
                          value={s.email} 
                          onChange={e => {
                            const next = [...signatories];
                            next[idx].email = e.target.value;
                            setSignatories(next);
                          }}
                          className="h-7 text-[10px] bg-background border-border/50"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Run count + prepare */}
              <div className="flex gap-2 items-end pt-3 border-t border-white/5">
                <div className="flex-1">
                  <label className="text-label block mb-2">Runs</label>
                  <Input type="number" min={1} max={50} value={runCount}
                    onChange={e => setRunCount(Math.max(1, Math.min(50, Number(e.target.value))))}
                    className="h-9 text-sm bg-white/5 border-white/10" />
                </div>
                <Button
                  className="h-9 gap-1.5 flex-shrink-0 bg-primary hover:bg-primary/80 text-white shadow-lg shadow-primary/20"
                  onClick={handlePrepare}
                  disabled={!selAppTypeId || intakeLoading}
                >
                  {intakeLoading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  Prepare
                </Button>
              </div>
            </div>
          </div>

          {/* Bulk Import card */}
          <div className="glass-panel rounded-2xl overflow-hidden border border-white/5 bg-card/30">
            <div className="px-4 py-3 border-b border-white/5 bg-white/5 flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-tight">Bulk Import</h3>
              <Import size={14} className="text-muted-foreground/40" />
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-label block mb-2">Request IDs</label>
                <textarea
                  value={importInput}
                  onChange={e => setImportInput(e.target.value)}
                  placeholder="e.g. 12345, 12346, 12347"
                  className="w-full min-h-[80px] text-xs bg-background border border-border rounded-md p-2 focus:outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Separate IDs by comma, space or newline.
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full h-9 gap-1.5 text-xs border-indigo-500/30 hover:bg-indigo-500/20 hover:text-indigo-400 transition-all shadow-lg shadow-indigo-500/10"
                onClick={handleImport}
                disabled={isImporting || !importInput.trim()}
              >
                {isImporting ? <Loader2 size={13} className="animate-spin" /> : <Import size={13} />}
                Import Requests
              </Button>
            </div>
          </div>

          {/* Recent Presets Card */}
          <div className="glass-panel rounded-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
            <div className="px-4 py-3 border-b border-white/5 bg-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={12} className="text-amber-400" />
                <h3 className="text-sm font-bold tracking-tight">Recent Sessions</h3>
              </div>
              {recentPresets.length > 0 && (
                <button 
                  onClick={() => setRecentPresets([])}
                  className="p-1 hover:bg-white/10 rounded-md text-muted-foreground/60 hover:text-red-400 transition-all font-bold text-[9px] uppercase tracking-widest flex items-center gap-1"
                  title="Clear history"
                >
                  <Trash2 size={10} /> Clear
                </button>
              )}
            </div>
            <div className="p-2 space-y-1">
              {recentPresets.length > 0 ? (
                recentPresets.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => {
                      setImportInput(preset.ids.join(", "));
                      toast.success("Preset loaded to import tool");
                    }}
                    className="w-full flex items-center justify-between p-2 rounded-xl text-left hover:bg-white/10 transition-all group border border-transparent hover:border-white/5"
                  >
                    <div className="flex flex-col">
                      <span className="text-[11px] font-bold text-foreground/80 group-hover:text-amber-400 transition-colors">{preset.label}</span>
                      <span className="text-label !text-muted-foreground/40">{preset.ids.length} Requests</span>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Plus size={10} className="text-amber-400" />
                    </div>
                  </button>
                ))
              ) : (
                <div className="py-6 px-4 text-center">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-2">
                    <Clock size={14} className="text-muted-foreground/30" />
                  </div>
                  <p className="text-[10px] text-muted-foreground/50 font-medium leading-relaxed">
                    No recent sessions yet.<br/>Runs are saved here automatically.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Fill mode + field selector */}
          {selAppTypeId && (
            <div className="glass-panel rounded-2xl overflow-hidden border border-white/5 bg-card/30">
              <div className="px-4 py-3 border-b border-white/5 bg-white/5 flex items-center justify-between">
                <h3 className="text-sm font-bold tracking-tight">Auto-Fill Settings</h3>
                {allFields.length > 0 && (
                  <span className="text-[10px] text-muted-foreground/60 font-medium">{selectedCount}/{allFields.length}</span>
                )}
              </div>

              {/* Mode selector */}
              <div className="g-2 p-3 flex gap-1.5 border-b border-white/5">
                {(["mandatory", "all", "custom"] as FillMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setFillMode(m)}
                    className={cn(
                      "flex-1 text-[10px] font-bold py-2 rounded-lg border transition-all capitalize tracking-tight",
                      fillMode === m
                        ? "bg-primary/20 text-primary border-primary/30 shadow-inner"
                        : "bg-white/5 border-white/5 text-muted-foreground hover:bg-white/10"
                    )}
                  >
                    {m === "mandatory" ? "Required" : m === "all" ? "All" : "Custom"}
                  </button>
                ))}
              </div>

              {/* Mode description */}
              <div className="px-4 py-2 text-[10px] text-muted-foreground/70 border-b border-white/5 italic">
                {fillMode === "mandatory" && `Fills ${mandatoryCount} required fields automatically.`}
                {fillMode === "all" && `Fills all ${allFields.length} fields automatically.`}
                {fillMode === "custom" && "Search and pick which fields to include."}
              </div>

              {/* Field list */}
              {intakeLoading ? (
                <div className="flex justify-center py-6"><Spinner size={20} /></div>
              ) : (
                <div>
                  {/* Search */}
                  <div className="p-2 border-b border-white/5 relative bg-white/5">
                    <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
                    <Input
                      placeholder="Search fields…"
                      value={fieldSearch}
                      onChange={e => setFieldSearch(e.target.value)}
                      className="h-8 text-[11px] pl-8 pr-8 bg-transparent border-white/10 focus-visible:ring-primary/30"
                    />
                    {fieldSearch && (
                      <button onClick={() => setFieldSearch("")} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  <div className="overflow-y-auto max-h-[380px] divide-y divide-white/5">
                    {filteredFields.map(f => {
                      const id = String(f.fieldId);
                      const mandatory = isMandatory(f);
                      const isChecked = fillMode === "all" ? true : fillMode === "mandatory" ? mandatory : customSelected.has(id);
                      const val = globalValues[id] ?? "";
                      const hasOptions = !!(f.selectOptions && Object.keys(f.selectOptions).length > 0) || !!(f.values?.length);

                      return (
                        <div key={id} className={cn(
                          "px-3 py-2.5 space-y-2 transition-colors", 
                          !isChecked && fillMode !== "custom" && "opacity-30",
                          isChecked && "bg-white/5"
                        )}>
                          {/* Field label row */}
                          <div className="flex items-center gap-2">
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
                                {customSelected.has(id) || mandatory ? <CheckSquare size={14} className="text-primary active:scale-90 transition-transform" /> : <Square size={14} className="active:scale-90 transition-transform" />}
                              </button>
                            ) : (
                              <div className={cn(
                                "w-1.5 h-1.5 rounded-full flex-shrink-0 transition-all", 
                                isChecked ? "bg-primary shadow-[0_0_8px_rgba(59,130,246,0.5)]" : "bg-white/20"
                              )} />
                            )}
                            <span className="text-[11px] font-semibold flex-1 min-w-0 truncate leading-none">
                              {f.displayName || f.fieldName}
                              {mandatory && <span className="text-red-400 ml-1 font-bold">*</span>}
                            </span>
                            <span className="text-[8px] font-bold text-muted-foreground/30 uppercase tracking-tighter flex-shrink-0 px-1.5 py-0.5 rounded border border-white/5 bg-white/5">{f.fieldType}</span>
                          </div>

                          {/* Value editor (shown when selected) */}
                          {isChecked && (
                            <div className="pl-4.5">
                              {hasOptions ? (
                                <select
                                  value={val}
                                  onChange={e => setGlobalValues(p => ({ ...p, [id]: e.target.value }))}
                                  className="w-full h-7 text-[10px] bg-black/20 border border-white/10 rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground/80 font-medium"
                                >
                                  <option value="">— Use auto-generated data —</option>
                                  {f.selectOptions
                                    ? Object.entries(f.selectOptions).map(([k, v]) => <option key={k} value={(v as string) || k}>{(v as string) || k}</option>)
                                    : f.values?.map(v => <option key={v.value} value={v.label || v.value}>{v.label || v.value}</option>)
                                  }
                                </select>
                              ) : (
                                <input
                                  value={val}
                                  onChange={e => setGlobalValues(p => ({ ...p, [id]: e.target.value }))}
                                  placeholder="Auto-generated dummy data"
                                  className="w-full h-7 text-[10px] bg-black/20 border border-white/10 rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:opacity-50 text-foreground/80 font-medium"
                                />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {filteredFields.length === 0 && (
                      <div className="py-10 text-center text-xs text-muted-foreground opacity-50 italic">
                        {allFields.length === 0 ? "No intake fields found" : "No results for your search"}
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
            <div className="glass-panel rounded-2xl p-4 flex items-center gap-6 flex-wrap animate-in fade-in slide-in-from-top-4 duration-500 border-white/10">
              <div className="flex items-center gap-6">
                 <StatPill label="Total" value={stats.total} />
                 <StatPill label="Done" value={stats.done} color="emerald" />
                 <StatPill label="Errors" value={stats.errors} color="red" />
                 <StatPill label="Running" value={stats.running} color="blue" />
              </div>
              <div className="flex-1 h-px bg-white/5 min-w-[20px]" />
              <div className="flex items-center gap-3">
                {isRunningAll && (
                  <div className="flex items-center gap-2 text-[10px] font-bold text-blue-400 uppercase tracking-widest bg-blue-500/10 px-3 py-1.5 rounded-full border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
                    <Loader2 size={12} className="animate-spin" /> Execution Active
                  </div>
                )}
                <Button variant="ghost" size="sm" className="h-9 px-4 gap-2 text-[11px] font-black uppercase tracking-widest text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all rounded-xl"
                  onClick={() => { setRuns([]); }}>
                  <Trash2 size={13} /> Clear Workspace
                </Button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {runs.length === 0 && (
            <div className="glass-panel border-dashed border-white/10 rounded-[2.5rem] flex flex-col items-center justify-center py-32 text-center animate-in fade-in zoom-in-95 duration-700">
              <div className="w-24 h-24 rounded-[2rem] bg-primary/5 border border-primary/10 flex items-center justify-center mb-8 shadow-[0_0_50px_rgba(59,130,246,0.1)] relative">
                <div className="absolute inset-0 rounded-[2rem] bg-primary/20 blur-2xl opacity-20 animate-pulse" />
                <FlaskConical size={40} className="text-primary/60 relative z-10" strokeWidth={1} />
              </div>
              <h3 className="text-2xl font-black tracking-tight mb-3">Bulk Test Engine</h3>
              <p className="text-sm text-muted-foreground max-w-sm leading-relaxed opacity-60">
                {selAppTypeId
                  ? "Your configuration is ready. Choose your fill strategy and click 'Prepare' to initialize the test suite."
                  : "Welcome. Start by selecting an Application Type from the sidebar to visualize the automation possibilities."}
              </p>
              {!selAppTypeId && (
                <div className="mt-8 flex items-center gap-2 text-[10px] font-bold text-primary uppercase tracking-[0.2em] bg-primary/10 px-4 py-2 rounded-full border border-primary/20">
                  <Play size={10} fill="currentColor" /> Select Type to Begin
                </div>
              )}
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
              onESignTest={() => handleESignTest(run)}
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
    <div className="flex flex-col items-start gap-0.5">
      <div className="flex items-center gap-2">
        <div className={cn(
          "w-1 h-1 rounded-full",
          color === "emerald" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" :
          color === "red" ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" :
          color === "blue" ? "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" :
          "bg-white/20"
        )} />
        <span className={cn(
          "text-xl font-black tabular-nums tracking-tighter leading-none",
          color === "emerald" ? "text-emerald-400" :
          color === "red" ? "text-red-400" :
          color === "blue" ? "text-blue-400" :
          "text-foreground/90"
        )}>{value}</span>
      </div>
      <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-3">{label}</span>
    </div>
  );
}
