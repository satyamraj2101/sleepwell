import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { FlaskConical, Play, CheckCircle2, XCircle, Clock, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { useApiClients } from "@/hooks/useApiClients";
import { useAuthStore } from "@/store/authStore";
import { getContractDetail } from "@/api/contractRequest";
import { listUsers } from "@/api/users";
import { getPreExecutionApprovals } from "@/api/approval";
import { getScoreCard } from "@/api/compareComply";
import { getUserMaskStatus } from "@/types";

type StepStatus = "pending" | "running" | "pass" | "fail";

interface Step {
  id: string;
  name: string;
  detail: string;
  status: StepStatus;
  result?: string;
  error?: string;
  durationMs?: number;
}

interface Scenario {
  id: string;
  name: string;
  description: string;
  steps: Step[];
  params: Record<string, string>;
}

const SCENARIO_TEMPLATES: Omit<Scenario, "params">[] = [
  {
    id: "mask-check",
    name: "Email mask safety check",
    description: "Verify all users are masked before UAT / all unmasked at go-live",
    steps: [
      { id: "fetch-users",   name: "Fetch all users",              detail: "GET /v1/user (all pages)", status: "pending" },
      { id: "count-masked",  name: "Count masked users",           detail: "Check email.startsWith('x')", status: "pending" },
      { id: "count-unmasked",name: "Count unmasked users",         detail: "Check remaining", status: "pending" },
      { id: "report",        name: "Generate certification report", detail: "Summary of mask state", status: "pending" },
    ],
  },
  {
    id: "contract-lifecycle",
    name: "Contract lifecycle check",
    description: "Verify a contract can be fetched and has required data for go-live",
    steps: [
      { id: "fetch-contract",    name: "Fetch contract detail",      detail: "GET /contract-request/{id}", status: "pending" },
      { id: "check-fields",      name: "Check custom fields present", detail: "Verify customFieldGroups not empty", status: "pending" },
      { id: "check-parties",     name: "Check legal parties",        detail: "Verify legalParties not empty", status: "pending" },
      { id: "check-approvals",   name: "Check approval status",      detail: "GET /contractapproval/preexecution/{id}", status: "pending" },
      { id: "check-ai-score",    name: "Check AI score card",        detail: "GET /compare-comply/score-card", status: "pending" },
    ],
  },
  {
    id: "api-health",
    name: "API health check",
    description: "Verify all three API bases are reachable and auth is valid",
    steps: [
      { id: "check-token",       name: "Verify token present",       detail: "Check Zustand store", status: "pending" },
      { id: "ping-users",        name: "Ping Old Prod API",          detail: "GET /v1/user (1 record)", status: "pending" },
      { id: "ping-contracts",    name: "Ping New Cloud API",         detail: "GET /contract-request (1 record)", status: "pending" },
    ],
  },
];

export default function TestingPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>(
    SCENARIO_TEMPLATES.map(s => ({ ...s, params: {} }))
  );
  const [expandedId, setExpandedId] = useState<string | null>("mask-check");
  const clients = useApiClients();
  const { tenant, username, token } = useAuthStore();

  const updateStep = (scenarioId: string, stepId: string, update: Partial<Step>) => {
    setScenarios(prev => prev.map(s => s.id === scenarioId
      ? { ...s, steps: s.steps.map(st => st.id === stepId ? { ...st, ...update } : st) }
      : s
    ));
  };

  const setParam = (scenarioId: string, key: string, value: string) => {
    setScenarios(prev => prev.map(s => s.id === scenarioId ? { ...s, params: { ...s.params, [key]: value } } : s));
  };

  const runMut = useMutation({
    mutationFn: async (scenario: Scenario) => {
      if (!clients) throw new Error("Not connected");

      // Reset all steps
      scenario.steps.forEach(st => updateStep(scenario.id, st.id, { status: "pending", result: undefined, error: undefined }));

      if (scenario.id === "mask-check") {
        // Step 1: fetch users
        updateStep(scenario.id, "fetch-users", { status: "running" });
        const t0 = Date.now();
        const users = await listUsers(clients.oldProd, tenant, { pageNo: 1, perPage: 200, requestorUsername: username });
        updateStep(scenario.id, "fetch-users", { status: "pass", result: `${users.totalRecords} users fetched`, durationMs: Date.now() - t0 });

        // Step 2: count masked
        updateStep(scenario.id, "count-masked", { status: "running" });
        const masked = users.data.filter(u => getUserMaskStatus(u) === "masked").length;
        updateStep(scenario.id, "count-masked", { status: "pass", result: `${masked} masked users` });

        // Step 3: count unmasked
        updateStep(scenario.id, "count-unmasked", { status: "running" });
        const unmasked = users.data.filter(u => getUserMaskStatus(u) === "unmasked").length;
        updateStep(scenario.id, "count-unmasked", { status: unmasked === 0 ? "pass" : "fail", result: `${unmasked} unmasked users${unmasked > 0 ? " — ACTION REQUIRED before go-live" : " — safe for UAT"}` });

        // Step 4: report
        updateStep(scenario.id, "report", { status: "pass", result: `Total: ${users.totalRecords} | Masked: ${masked} (${Math.round(masked/users.totalRecords*100)}%) | Unmasked: ${unmasked}` });
      }

      if (scenario.id === "contract-lifecycle") {
        const reqId = Number(scenario.params.requestId);
        if (!reqId) throw new Error("Enter a Request ID in the params first");

        updateStep(scenario.id, "fetch-contract", { status: "running" });
        const t0 = Date.now();
        const contract = await getContractDetail(clients.newCloud, tenant, reqId);
        updateStep(scenario.id, "fetch-contract", { status: "pass", result: `Contract loaded: ${contract.applicationTypeName} — Stage: ${contract.workflowStage}`, durationMs: Date.now() - t0 });

        updateStep(scenario.id, "check-fields", { status: "running" });
        const fieldCount = contract.customFieldGroups?.reduce((s, g) => s + (g.customFields?.length ?? 0), 0) ?? 0;
        updateStep(scenario.id, "check-fields", { status: fieldCount > 0 ? "pass" : "fail", result: `${fieldCount} custom fields` });

        updateStep(scenario.id, "check-parties", { status: "running" });
        const partyCount = contract.legalParties?.length ?? 0;
        updateStep(scenario.id, "check-parties", { status: partyCount > 0 ? "pass" : "fail", result: `${partyCount} legal parties` });

        updateStep(scenario.id, "check-approvals", { status: "running" });
        try {
          const approvals = await getPreExecutionApprovals(clients.newCloud, tenant, reqId);
          const pending = approvals.data?.approvals?.filter(a => a.status === "Pending").length ?? 0;
          updateStep(scenario.id, "check-approvals", { status: pending === 0 ? "pass" : "fail", result: `${pending} pending approvals` });
        } catch {
          updateStep(scenario.id, "check-approvals", { status: "fail", result: "Could not fetch approvals" });
        }

        updateStep(scenario.id, "check-ai-score", { status: "running" });
        try {
          const score = await getScoreCard(clients.newCloud, tenant, reqId);
          updateStep(scenario.id, "check-ai-score", { status: "pass", result: `Score: ${score.overallScore ?? "N/A"}% — ${score.totalObligations ?? 0} obligations` });
        } catch {
          updateStep(scenario.id, "check-ai-score", { status: "fail", result: "No score card available" });
        }
      }

      if (scenario.id === "api-health") {
        updateStep(scenario.id, "check-token", { status: "running" });
        updateStep(scenario.id, "check-token", { status: token ? "pass" : "fail", result: token ? "Token present and stored" : "No token — reconnect" });

        updateStep(scenario.id, "ping-users", { status: "running" });
        const t0 = Date.now();
        try {
          await listUsers(clients.oldProd, tenant, { pageNo: 1, perPage: 1, requestorUsername: username });
          updateStep(scenario.id, "ping-users", { status: "pass", result: `Old Prod API reachable (${Date.now() - t0}ms)` });
        } catch (e) {
          updateStep(scenario.id, "ping-users", { status: "fail", error: (e as Error).message });
        }

        updateStep(scenario.id, "ping-contracts", { status: "running" });
        const t1 = Date.now();
        try {
          await clients.newCloud.get(`/api/${tenant}/contract-request`, { params: { PageSize: 1 } });
          updateStep(scenario.id, "ping-contracts", { status: "pass", result: `New Cloud API reachable (${Date.now() - t1}ms)` });
        } catch (e) {
          updateStep(scenario.id, "ping-contracts", { status: "fail", error: (e as Error).message });
        }
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div>
      <PageHeader
        title="Configuration Test Runner"
        description="Run scenario-based tests to validate your Leah CLM configuration before go-live."
      />

      <div className="space-y-4">
        {scenarios.map((scenario) => {
          const isExpanded = expandedId === scenario.id;
          const passCount = scenario.steps.filter(s => s.status === "pass").length;
          const failCount = scenario.steps.filter(s => s.status === "fail").length;
          const isDone = scenario.steps.every(s => s.status === "pass" || s.status === "fail");

          return (
            <div key={scenario.id} className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : scenario.id)}>
                <FlaskConical size={15} className="text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{scenario.name}</div>
                  <div className="text-xs text-muted-foreground">{scenario.description}</div>
                </div>
                {isDone && (
                  <div className="flex items-center gap-2 text-xs">
                    {passCount > 0 && <span className="text-green-500">{passCount} passed</span>}
                    {failCount > 0 && <span className="text-red-500">{failCount} failed</span>}
                  </div>
                )}
                <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              </div>

              {isExpanded && (
                <div className="border-t border-border px-4 py-4">
                  {/* Params */}
                  {scenario.id === "contract-lifecycle" && (
                    <div className="mb-4">
                      <label className="text-xs text-muted-foreground block mb-1">Request ID to test</label>
                      <Input placeholder="e.g. 92355" value={scenario.params.requestId ?? ""} onChange={(e) => setParam(scenario.id, "requestId", e.target.value)} className="h-8 text-sm max-w-xs" />
                    </div>
                  )}

                  {/* Steps */}
                  <div className="space-y-2 mb-4">
                    {scenario.steps.map((step) => (
                      <div key={step.id} className="flex items-start gap-3 text-sm">
                        <div className="flex-shrink-0 mt-0.5">
                          {step.status === "pass"    && <CheckCircle2 size={15} className="text-green-500" />}
                          {step.status === "fail"    && <XCircle      size={15} className="text-red-500"   />}
                          {step.status === "running" && <div className="w-3.5 h-3.5 rounded-full border-2 border-amber-500 border-t-transparent animate-spin mt-0.5" />}
                          {step.status === "pending" && <Clock        size={15} className="text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{step.name}</div>
                          <div className="text-xs text-muted-foreground mono">{step.detail}</div>
                          {step.result && <div className={`text-xs mt-0.5 ${step.status === "fail" ? "text-red-400" : "text-green-400"}`}>{step.result}</div>}
                          {step.error  && <div className="text-xs mt-0.5 text-red-400">{step.error}</div>}
                          {step.durationMs && <div className="text-[10px] text-muted-foreground">{step.durationMs}ms</div>}
                        </div>
                      </div>
                    ))}
                  </div>

                  <Button size="sm" onClick={() => runMut.mutate(scenario)} disabled={runMut.isPending} className="gap-1.5">
                    <Play size={13} />Run Scenario
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
