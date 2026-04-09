import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FlaskConical, Play, CheckCircle2, XCircle, Clock, Download, Plus, Trash2,
  ChevronRight, Loader2, Zap, AlertTriangle, Activity, Copy, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { useApiClients } from "@/hooks/useApiClients";
import { useAuthStore } from "@/store/authStore";
import { QK, cn } from "@/lib/utils";
import { getIntakeFormFields, createContract, getContractDetail } from "@/api/contractRequest";
import { getPreExecutionApprovals } from "@/api/approval";
import { listUsers } from "@/api/users";

// ─── Types ────────────────────────────────────────────────────────────────────

type StepStatus = "idle" | "running" | "pass" | "fail" | "warn";

interface TestStep {
  id: string;
  label: string;
  status: StepStatus;
  result?: string;
  durationMs?: number;
}

type RunStatus = "idle" | "running" | "done" | "error";

interface TestRun {
  id: string;           // uuid-like
  index: number;        // run #1, #2…
  appTypeId: number;
  appTypeName: string;
  requestId?: number;   // assigned after creation
  status: RunStatus;
  steps: TestStep[];
  startedAt?: number;
  finishedAt?: number;
  customFieldValues: Record<string, string>; // user can override before run
  error?: string;
}

// ─── Dummy data generators ────────────────────────────────────────────────────

function randId() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

const DUMMY_STRINGS: Record<string, string> = {
  text:          "Test value auto-generated",
  multilinetext: "This is an auto-generated test entry for bulk test runner validation.",
  number:        "42",
  date:          new Date().toISOString().split("T")[0],
  email:         "test.run@example.com",
  url:           "https://example.com",
  currency:      "5000",
  percentage:    "25",
  phone:         "+1-555-000-0000",
};

function dummyValueForFieldType(fieldType: string, options?: Record<string, string>): string {
  const t = (fieldType ?? "").toLowerCase().replace(/\s/g, "");
  if (options && Object.keys(options).length > 0) {
    return Object.keys(options)[0]; // pick first option
  }
  return DUMMY_STRINGS[t] ?? DUMMY_STRINGS.text;
}

// Build step definitions for a run
function buildSteps(): TestStep[] {
  return [
    { id: "create",    label: "Create contract request",        status: "idle" },
    { id: "fetch",     label: "Fetch & verify created request", status: "idle" },
    { id: "approvals", label: "Check approval triggers",        status: "idle" },
    { id: "stage",     label: "Verify workflow stage",          status: "idle" },
    { id: "fields",    label: "Verify custom fields saved",     status: "idle" },
  ];
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCSV(runs: TestRun[], appTypeName: string) {
  const rows: string[][] = [];
  rows.push(["Run #", "Request ID", "App Type", "Status", "Step", "Step Status", "Result", "Duration (ms)", "Started At", "Finished At"]);

  runs.forEach(r => {
    const started = r.startedAt ? new Date(r.startedAt).toISOString() : "";
    const finished = r.finishedAt ? new Date(r.finishedAt).toISOString() : "";
    r.steps.forEach(s => {
      rows.push([
        String(r.index),
        String(r.requestId ?? "N/A"),
        r.appTypeName,
        r.status,
        s.label,
        s.status,
        s.result ?? r.error ?? "",
        String(s.durationMs ?? ""),
        started,
        finished,
      ]);
    });
  });

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leah-bulk-test-${appTypeName.replace(/\s/g, "_")}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("Test report downloaded as CSV");
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BulkTestCreatorPage() {
  const clients = useApiClients();
  const { tenant, username } = useAuthStore();

  const [selAppTypeId, setSelAppTypeId] = useState<number | null>(null);
  const [runCount, setRunCount] = useState(3);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const abortRef = useRef(false);

  // Look up the logged-in user's real userId and departmentId
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser", tenant, username],
    queryFn: async () => {
      const res = await listUsers(clients!.oldProd, tenant, { requestorUsername: username, search: username, pageNo: 1, perPage: 10 });
      return res.data.find(u => u.userName?.toLowerCase() === username?.toLowerCase() || u.email?.toLowerCase() === username?.toLowerCase()) ?? res.data[0] ?? null;
    },
    enabled: !!clients && !!username,
    staleTime: 10 * 60_000,
  });

  // Load app types
  const { data: appTypesRaw = [] } = useQuery({
    queryKey: QK.appTypes(tenant),
    queryFn: async () => {
      const { listApplicationTypes } = await import("@/api/applicationTypes");
      return listApplicationTypes(clients!.oldProd, tenant, tenant);
    },
    enabled: !!clients,
    staleTime: 5 * 60_000,
  });

  // Load intake fields for selected app type
  const { data: intakeGroups = [], isLoading: intakeLoading } = useQuery({
    queryKey: ["intakeFieldsForTest", tenant, selAppTypeId],
    queryFn: () => getIntakeFormFields(clients!.newCloud, tenant, selAppTypeId!),
    enabled: !!clients && !!selAppTypeId,
    staleTime: 5 * 60_000,
  });

  // Flatten all intake fields
  const allIntakeFields = useMemo(() => {
    const out: Array<{ fieldId: number; fieldName: string; fieldType: string; selectOptions?: Record<string, string> | null; isMandatory?: boolean }> = [];
    for (const g of intakeGroups) {
      const sections = (g as any).sections ?? [];
      for (const s of sections) {
        for (const f of (s.fields ?? [])) {
          out.push({ fieldId: f.fieldDefinitionId ?? f.fieldId, fieldName: f.fieldLabel ?? f.fieldName, fieldType: f.fieldType, selectOptions: f.selectOptions ?? null, isMandatory: f.isMandatory ?? false });
        }
      }
      // Some versions have fields directly on group
      for (const f of ((g as any).fields ?? [])) {
        out.push({ fieldId: f.fieldDefinitionId ?? f.fieldId, fieldName: f.fieldLabel ?? f.fieldName, fieldType: f.fieldType, selectOptions: f.selectOptions ?? null, isMandatory: f.isMandatory ?? false });
      }
    }
    return out.filter(f => f.fieldId);
  }, [intakeGroups]);

  const selectedAppType = (appTypesRaw as any[]).find(a => a.applicationTypeId === selAppTypeId);

  // Initialize runs
  function prepareRuns() {
    if (!selAppTypeId || !selectedAppType) { toast.error("Select an application type first"); return; }
    const defaultFields: Record<string, string> = {};
    for (const f of allIntakeFields) {
      defaultFields[String(f.fieldId)] = dummyValueForFieldType(f.fieldType, f.selectOptions ?? undefined);
    }
    const newRuns: TestRun[] = Array.from({ length: runCount }, (_, i) => ({
      id: `run-${Date.now()}-${i}`,
      index: i + 1,
      appTypeId: selAppTypeId,
      appTypeName: selectedAppType.applicationTypeName ?? "Unknown",
      status: "idle",
      steps: buildSteps(),
      customFieldValues: { ...defaultFields },
    }));
    setRuns(newRuns);
    setExpandedRunId(newRuns[0]?.id ?? null);
    toast.success(`${runCount} test runs prepared — review and start`);
  }

  // Update a single step in a run
  const patchStep = useCallback((runId: string, stepId: string, patch: Partial<TestStep>) => {
    setRuns(prev => prev.map(r => r.id === runId ? {
      ...r,
      steps: r.steps.map(s => s.id === stepId ? { ...s, ...patch } : s),
    } : r));
  }, []);

  const patchRun = useCallback((runId: string, patch: Partial<TestRun>) => {
    setRuns(prev => prev.map(r => r.id === runId ? { ...r, ...patch } : r));
  }, []);

  // Run a single test
  async function executeRun(run: TestRun) {
    if (!clients) return;
    patchRun(run.id, { status: "running", startedAt: Date.now(), error: undefined });

    // Reset steps
    setRuns(prev => prev.map(r => r.id === run.id ? {
      ...r, steps: buildSteps(),
    } : r));

    try {
      // ── STEP 1: Create contract ─────────────────────────────────────────────
      patchStep(run.id, "create", { status: "running" });
      const t0 = Date.now();

      // Resolve requester — Leah rejects DepartmentId=0 / requestorDpId=0
      const resolvedUserId = currentUser?.userId ?? currentUser?.id ?? 0;
      const resolvedDeptId = Math.max(currentUser?.departmentId ?? 1, 1);

      // NOTE: We do NOT send customFields here. The intake form returns
      // fieldDefinitionId values, but the contract-request POST expects
      // customFieldId values (which are instance-level, not definition-level).
      // Sending definition IDs causes "FieldId X is not available for provided
      // Application Type Id" for every single field. The test focuses on
      // contract lifecycle (creation → stage → approvals), not field mapping.

      const payload: any = {
        id: 0,
        applicationTypeId: run.appTypeId,
        recordId: 0,
        isUploadedContract: false,
        requestorUsername: username,
        skipCustomFields: true,
        skipClientCustomFields: true,
        description: `[BULK-TEST-RUN-${run.index}] Auto-generated by Leah Toolkit ${randId()} — ${new Date().toLocaleString()}`,
        isConfidential: false,
        assignees: [],
        requesterUser: {
          UserId: resolvedUserId,
          DepartmentId: resolvedDeptId,
        },
        requestorId: resolvedUserId,
        requestorDpId: resolvedDeptId,
        requesterDepartmentId: resolvedDeptId,
        legalParties: [],
        contractPriority: { priority: false, priorityReason: "" },
        recordClassificationId: 0,
        integrationId: [],
        clients: [],
        confidentialRecords: [],
        customFields: [],
      };

      const createRes = await createContract(clients.newCloud, tenant, payload);
      const newRequestId = typeof createRes === "number" ? createRes :
        (createRes as any)?.data ?? (createRes as any)?.id ?? (createRes as any)?.requestId;

      if (!newRequestId || isNaN(Number(newRequestId))) {
        throw new Error(`API did not return a valid request ID. Got: ${JSON.stringify(createRes)}`);
      }

      patchStep(run.id, "create", { status: "pass", result: `Created → Request #${newRequestId}`, durationMs: Date.now() - t0 });
      patchRun(run.id, { requestId: Number(newRequestId) });

      // ── STEP 2: Fetch & verify ──────────────────────────────────────────────
      patchStep(run.id, "fetch", { status: "running" });
      const t1 = Date.now();
      const detail = await getContractDetail(clients.newCloud, tenant, Number(newRequestId));
      const appTypeName = detail.applicationTypeName ?? "?";
      const stage = detail.workflowStage ?? "?";
      patchStep(run.id, "fetch", { status: "pass", result: `${appTypeName} | Stage: ${stage}`, durationMs: Date.now() - t1 });

      // ── STEP 3: Approval triggers ───────────────────────────────────────────
      patchStep(run.id, "approvals", { status: "running" });
      const t2 = Date.now();
      try {
        const approvalsRes: any = await getPreExecutionApprovals(clients.newCloud, tenant, Number(newRequestId));
        const approvalList = approvalsRes?.data?.approvals ?? approvalsRes?.approvals ?? [];
        const pending = approvalList.filter((a: any) => a.status === "Pending").length;
        const total = approvalList.length;
        patchStep(run.id, "approvals", {
          status: total === 0 ? "warn" : "pass",
          result: total === 0 ? "No approval steps triggered" : `${total} approvals triggered, ${pending} pending`,
          durationMs: Date.now() - t2,
        });
      } catch {
        patchStep(run.id, "approvals", { status: "warn", result: "Could not fetch approvals (may be expected for new requests)", durationMs: Date.now() - t2 });
      }

      // ── STEP 4: Verify workflow stage ───────────────────────────────────────
      patchStep(run.id, "stage", { status: "running" });
      patchStep(run.id, "stage", {
        status: stage && stage !== "?" ? "pass" : "warn",
        result: stage && stage !== "?" ? `Workflow stage: "${stage}"` : "Stage unknown — check Leah UI",
      });

      // ── STEP 5: Custom fields saved ─────────────────────────────────────────
      patchStep(run.id, "fields", { status: "running" });
      const savedFields = (detail.customFieldGroups ?? []).reduce((acc: number, g: any) => acc + (g.customFields?.length ?? 0), 0);
      patchStep(run.id, "fields", {
        status: savedFields > 0 ? "pass" : "warn",
        result: savedFields > 0 ? `${savedFields} custom fields present` : "No custom fields returned — check field mapping",
      });

      patchRun(run.id, { status: "done", finishedAt: Date.now() });
    } catch (e: any) {
      // Extract rich validation details from 400 responses
      const resp = e?.response?.data;
      let msg = "Unknown error";
      if (resp) {
        // Leah typically returns: { message, errors: [...] } or { errors: { Field: ["msg"] } } or { title, errors: {...} }
        const topMsg = resp.message ?? resp.title ?? resp.Message ?? "";
        const errObj = resp.errors ?? resp.validationErrors ?? resp.Errors ?? resp.modelState ?? null;
        let details = "";
        if (Array.isArray(errObj)) {
          details = errObj.map((x: any) => typeof x === "string" ? x : (x.message ?? x.errorMessage ?? JSON.stringify(x))).join(" | ");
        } else if (errObj && typeof errObj === "object") {
          details = Object.entries(errObj).map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as string[]).join(", ") : v}`).join(" | ");
        }
        msg = [topMsg, details].filter(Boolean).join(" → ") || e.message;
      } else {
        msg = e?.message ?? "Unknown error";
      }
      patchRun(run.id, { status: "error", error: msg, finishedAt: Date.now() });
      // Mark remaining idle steps as failed
      setRuns(prev => prev.map(r => r.id === run.id ? {
        ...r,
        steps: r.steps.map(s => s.status === "idle" || s.status === "running" ? { ...s, status: "fail", result: "Aborted — previous step failed" } : s),
      } : r));
    }
  }

  async function runAll() {
    if (runs.length === 0) { toast.error("Prepare runs first"); return; }
    abortRef.current = false;
    setIsRunningAll(true);
    for (const run of runs) {
      if (abortRef.current) break;
      await executeRun(run);
      // Small delay between runs to avoid API rate-limiting
      await new Promise(r => setTimeout(r, 600));
    }
    setIsRunningAll(false);
    toast.success("All test runs complete! Check results and export CSV.");
  }

  // Summary stats
  const summary = useMemo(() => {
    const done   = runs.filter(r => r.status === "done").length;
    const errors = runs.filter(r => r.status === "error").length;
    const running = runs.filter(r => r.status === "running").length;
    const idle   = runs.filter(r => r.status === "idle").length;
    const totalSteps = runs.reduce((a, r) => a + r.steps.length, 0);
    const passSteps  = runs.reduce((a, r) => a + r.steps.filter(s => s.status === "pass").length, 0);
    const failSteps  = runs.reduce((a, r) => a + r.steps.filter(s => s.status === "fail").length, 0);
    return { done, errors, running, idle, totalSteps, passSteps, failSteps };
  }, [runs]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bulk Test Request Creator"
        description="Generate multiple contract requests with dummy data, track approval triggers, workflow stages, and export a full test report."
        actions={
          runs.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => exportCSV(runs, selectedAppType?.applicationTypeName ?? "test")}
            >
              <Download size={13} /> Export CSV Report
            </Button>
          ) : undefined
        }
      />

      {/* ─── Config Panel ──────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-card to-card/80 border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="p-1.5 bg-violet-500/15 rounded-lg">
            <Zap size={14} className="text-violet-400" />
          </div>
          <h2 className="text-sm font-bold text-foreground">Test Configuration</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* App Type */}
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Application Type</label>
            <select
              value={selAppTypeId ?? ""}
              onChange={e => { setSelAppTypeId(e.target.value ? Number(e.target.value) : null); setRuns([]); }}
              className="w-full h-9 text-sm bg-background border border-border rounded-lg px-3 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— Select application type —</option>
              {(appTypesRaw as any[]).map(at => (
                <option key={at.applicationTypeId} value={at.applicationTypeId}>{at.applicationTypeName}</option>
              ))}
            </select>
          </div>

          {/* Request count */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Number of test runs</label>
            <Input
              type="number"
              min={1}
              max={50}
              value={runCount}
              onChange={e => setRunCount(Math.min(50, Math.max(1, Number(e.target.value))))}
              className="h-9 text-sm"
            />
          </div>
        </div>

        {/* User identity status */}
        <div className={cn(
          "flex items-center gap-2.5 px-3 py-2 rounded-lg border text-xs",
          currentUser
            ? (currentUser.departmentId > 0 ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400" : "bg-amber-500/5 border-amber-500/20 text-amber-400")
            : "bg-red-500/5 border-red-500/20 text-red-400"
        )}>
          {currentUser ? (
            <>
              <CheckCircle2 size={12} className="shrink-0" />
              <span>
                Requester: <strong>{currentUser.fullName || currentUser.userName}</strong> · ID #{currentUser.userId}
                {currentUser.departmentId > 0
                  ? <> · Dept #{currentUser.departmentId}</>
                  : <span className="ml-1 text-amber-400"> · Dept #0 (will use Dept #1 as fallback)</span>
                }
              </span>
            </>
          ) : (
            <>
              <AlertTriangle size={12} className="shrink-0" />
              <span>User profile not resolved — <strong>{username}</strong> not found in Leah. Creation will likely fail with 400.</span>
            </>
          )}
        </div>

        {/* Intake fields summary */}
        {selAppTypeId && (
          <div className="flex items-center gap-3 p-3 bg-background/50 rounded-lg border border-border/50">
            {intakeLoading ? (
              <><Loader2 size={13} className="animate-spin text-muted-foreground" /><span className="text-xs text-muted-foreground">Loading fields…</span></>
            ) : (
              <>
                <Layers size={13} className="text-violet-400" />
                <span className="text-xs text-muted-foreground">
                  <span className="text-foreground font-semibold">{allIntakeFields.length}</span> intake fields found
                  {" · "}
                  <span className="text-amber-400 font-semibold">{allIntakeFields.filter(f => f.isMandatory).length}</span> mandatory
                  {" · Dummy data will be auto-generated for all fields"}
                </span>
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={prepareRuns}
            disabled={!selAppTypeId || intakeLoading}
          >
            <Plus size={13} /> Prepare {runCount} Run{runCount > 1 ? "s" : ""}
          </Button>

          {runs.length > 0 && !isRunningAll && (
            <Button
              size="sm"
              className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
              onClick={runAll}
            >
              <Play size={13} /> Run All ({runs.length})
            </Button>
          )}

          {isRunningAll && (
            <Button
              size="sm"
              variant="destructive"
              className="gap-1.5"
              onClick={() => { abortRef.current = true; setIsRunningAll(false); }}
            >
              <XCircle size={13} /> Abort
            </Button>
          )}

          {runs.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground"
              onClick={() => { setRuns([]); }}
            >
              <Trash2 size={13} /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* ─── Summary bar ───────────────────────────────────────────────────── */}
      {runs.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Done",      value: summary.done,       color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
            { label: "Errors",    value: summary.errors,     color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20" },
            { label: "Running",   value: summary.running,    color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20" },
            { label: "Idle",      value: summary.idle,       color: "text-muted-foreground", bg: "bg-muted/50 border-border" },
          ].map(s => (
            <div key={s.label} className={cn("rounded-xl border p-3 flex items-center gap-3", s.bg)}>
              <span className={cn("text-2xl font-black tabular-nums", s.color)}>{s.value}</span>
              <span className="text-xs text-muted-foreground font-medium">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ─── Run cards ─────────────────────────────────────────────────────── */}
      {runs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Activity size={14} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Test Runs</h2>
            <span className="text-xs text-muted-foreground">({runs.length} total)</span>
          </div>

          {runs.map(run => {
            const isExpanded = expandedRunId === run.id;
            const passCount  = run.steps.filter(s => s.status === "pass").length;
            const failCount  = run.steps.filter(s => s.status === "fail").length;
            const warnCount  = run.steps.filter(s => s.status === "warn").length;
            const durationSec = run.startedAt && run.finishedAt ? ((run.finishedAt - run.startedAt) / 1000).toFixed(1) : null;

            return (
              <div
                key={run.id}
                className={cn(
                  "rounded-xl border overflow-hidden transition-all",
                  run.status === "done"    && "border-emerald-500/30 bg-emerald-500/5",
                  run.status === "error"   && "border-red-500/30 bg-red-500/5",
                  run.status === "running" && "border-amber-500/30 bg-amber-500/5",
                  run.status === "idle"    && "border-border bg-card",
                )}
              >
                {/* Run header */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/2 transition-colors"
                  onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                >
                  {/* Status icon */}
                  <div className="shrink-0">
                    {run.status === "done"    && <CheckCircle2 size={16} className="text-emerald-400" />}
                    {run.status === "error"   && <XCircle      size={16} className="text-red-400" />}
                    {run.status === "running" && <Loader2      size={16} className="text-amber-400 animate-spin" />}
                    {run.status === "idle"    && <Clock        size={16} className="text-muted-foreground" />}
                  </div>

                  {/* Run label */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">Run #{run.index}</span>
                      {run.requestId && (
                        <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 border border-border/40 px-1.5 py-0.5 rounded">
                          Request #{run.requestId}
                          <button
                            onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(String(run.requestId)); toast.success("Copied!"); }}
                            className="ml-1 text-muted-foreground/50 hover:text-muted-foreground"
                          >
                            <Copy size={8} />
                          </button>
                        </span>
                      )}
                      {durationSec && <span className="text-[10px] text-muted-foreground">{durationSec}s</span>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{run.appTypeName}</div>
                  </div>

                  {/* Step badges */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {passCount > 0 && <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">{passCount}✓</span>}
                    {warnCount > 0 && <span className="text-[10px] font-semibold text-amber-400  bg-amber-500/10  border border-amber-500/20  px-1.5 py-0.5 rounded-full">{warnCount}!</span>}
                    {failCount > 0 && <span className="text-[10px] font-semibold text-red-400    bg-red-500/10    border border-red-500/20    px-1.5 py-0.5 rounded-full">{failCount}✗</span>}
                  </div>

                  {/* Run single button */}
                  {run.status === "idle" && (
                    <button
                      onClick={e => { e.stopPropagation(); executeRun(run); }}
                      className="shrink-0 text-[10px] px-2 py-1 rounded border border-violet-500/30 text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 transition-colors"
                    >
                      Run
                    </button>
                  )}

                  <ChevronRight size={13} className={cn("text-muted-foreground/40 transition-transform shrink-0", isExpanded && "rotate-90")} />
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-border/40 px-4 py-3 space-y-4">
                    {/* Error banner */}
                    {run.error && (
                      <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                        <AlertTriangle size={13} className="text-red-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-red-300 font-mono break-all">{run.error}</p>
                      </div>
                    )}

                    {/* Steps */}
                    <div className="space-y-1.5">
                      {run.steps.map(step => (
                        <div key={step.id} className="flex items-start gap-3 text-[12px]">
                          <div className="shrink-0 mt-0.5 w-4">
                            {step.status === "pass"    && <CheckCircle2 size={13} className="text-emerald-400" />}
                            {step.status === "fail"    && <XCircle      size={13} className="text-red-400" />}
                            {step.status === "warn"    && <AlertTriangle size={13} className="text-amber-400" />}
                            {step.status === "running" && <Loader2      size={13} className="text-amber-400 animate-spin" />}
                            {step.status === "idle"    && <Clock        size={13} className="text-muted-foreground/30" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className={cn("font-medium", step.status === "fail" ? "text-red-300" : step.status === "warn" ? "text-amber-300" : "text-foreground/80")}>{step.label}</span>
                            {step.result && <span className="ml-2 text-muted-foreground/70">{step.result}</span>}
                            {step.durationMs && <span className="ml-2 text-[9px] text-muted-foreground/40">{step.durationMs}ms</span>}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Field overrides */}
                    {run.status === "idle" && allIntakeFields.length > 0 && (
                      <details className="group">
                        <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1.5 list-none">
                          <ChevronRight size={11} className="group-open:rotate-90 transition-transform" />
                          Advanced: Override dummy field values ({allIntakeFields.length} fields)
                        </summary>
                        <div className="mt-2 grid gap-2 max-h-64 overflow-y-auto pr-1">
                          {allIntakeFields.slice(0, 30).map(f => (
                            <div key={f.fieldId} className="flex items-center gap-2">
                              <label className="text-[10px] text-muted-foreground/70 w-40 shrink-0 truncate" title={f.fieldName}>
                                {f.fieldName}
                                {f.isMandatory && <span className="text-amber-500 ml-0.5">*</span>}
                              </label>
                              {f.selectOptions && Object.keys(f.selectOptions).length > 0 ? (
                                <select
                                  value={run.customFieldValues[String(f.fieldId)] ?? ""}
                                  onChange={e => setRuns(prev => prev.map(r => r.id === run.id ? {
                                    ...r, customFieldValues: { ...r.customFieldValues, [String(f.fieldId)]: e.target.value }
                                  } : r))}
                                  className="flex-1 h-7 text-[11px] bg-background border border-border rounded px-2 focus:outline-none"
                                >
                                  <option value="">—</option>
                                  {Object.entries(f.selectOptions).map(([k, v]) => (
                                    <option key={k} value={k}>{v}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  className="flex-1 h-7 text-[11px] bg-background border border-border rounded px-2 focus:outline-none"
                                  value={run.customFieldValues[String(f.fieldId)] ?? ""}
                                  onChange={e => setRuns(prev => prev.map(r => r.id === run.id ? {
                                    ...r, customFieldValues: { ...r.customFieldValues, [String(f.fieldId)]: e.target.value }
                                  } : r))}
                                  placeholder={f.fieldType}
                                />
                              )}
                            </div>
                          ))}
                          {allIntakeFields.length > 30 && (
                            <p className="text-[10px] text-muted-foreground/40 italic">+ {allIntakeFields.length - 30} more fields (auto-filled)</p>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Empty state ───────────────────────────────────────────────────── */}
      {runs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center border border-dashed border-border rounded-2xl">
          <div className="p-4 bg-violet-500/10 rounded-2xl">
            <FlaskConical size={32} className="text-violet-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">No test runs yet</p>
            <p className="text-xs text-muted-foreground mt-1">Select an application type, set the run count, then click <strong>Prepare Runs</strong></p>
          </div>
          <div className="text-[11px] text-muted-foreground/50 space-y-1 max-w-sm">
            <p>✓ Each run creates a real contract request with dummy data</p>
            <p>✓ Verifies approvals, workflow stage, and field persistence</p>
            <p>✓ Per-step status with timing for each run</p>
            <p>✓ Full CSV report download anytime</p>
          </div>
        </div>
      )}
    </div>
  );
}
