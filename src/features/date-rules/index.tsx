import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, PlayCircle, Calendar, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Spinner, EmptyState, ErrorAlert } from "@/components/shared/PageHeader";
import { useApiClients } from "@/hooks/useApiClients";
import { useAuthStore } from "@/store/authStore";
import { useAppTypes } from "@/features/contract-edit/hooks";
import { listDateRules, evaluateDateRule, getExecutedRules, createDateRule, listDateRuleFields } from "@/api/dateRules";
import { QK, fmtDate } from "@/lib/utils";

const OPERATIONS = ["AddDays", "AddMonths", "AddYears", "SubtractDays", "SubtractMonths"] as const;

export default function DateRulesPage() {
  const [selAppTypeId, setSelAppTypeId] = useState<number | null>(null);
  const [previewReqId, setPreviewReqId] = useState("");
  const [evalForm, setEvalForm] = useState({ sourceFieldKey: "", targetFieldKey: "", operation: "AddMonths", value: "12", baseDate: "" });
  const [evalResult, setEvalResult] = useState<{ sourceDate: string; calculatedDate: string } | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const clients = useApiClients();
  const { tenant } = useAuthStore();
  const { data: appTypes } = useAppTypes();
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: QK.dateRules(tenant, selAppTypeId ?? undefined),
    queryFn: () => listDateRules(clients!.newCloud, tenant, { applicationTypeId: selAppTypeId ?? undefined }),
    enabled: !!clients,
  });

  const { data: executed, refetch: refetchExecuted } = useQuery({
    queryKey: ["executedRules", tenant, previewReqId],
    queryFn: () => getExecutedRules(clients!.newCloud, tenant, Number(previewReqId)),
    enabled: !!clients && !!previewReqId && /^\d+$/.test(previewReqId),
  });

  const evalMut = useMutation({
    mutationFn: () =>
      evaluateDateRule(clients!.newCloud, tenant, {
        sourceFieldKey: evalForm.sourceFieldKey,
        targetFieldKey: evalForm.targetFieldKey || "calculatedDate",
        operation: evalForm.operation,
        value: Number(evalForm.value),
        baseDate: evalForm.baseDate,
      }),
    onSuccess: (res) => setEvalResult(res),
    onError: (e) => toast.error((e as Error).message),
  });

  const rules = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Date Calculation Rule Manager"
        description="Create, preview, and validate automatic date rules before activating on production contracts."
        actions={
          <Button size="sm" onClick={() => setShowCreateModal(true)} className="gap-1.5">
            <Plus size={13} />New Rule
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        {/* Preview evaluator */}
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <PlayCircle size={15} className="text-amber-500" />
            <span className="text-sm font-semibold">Rule Preview</span>
            <span className="text-xs text-muted-foreground">— test a rule before activating it</span>
          </div>
          <div className="space-y-2.5">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Source field key (optional)</label>
              <Input
                value={evalForm.sourceFieldKey}
                onChange={(e) => setEvalForm((p) => ({ ...p, sourceFieldKey: e.target.value }))}
                placeholder="e.g. startDate"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Base date</label>
              <Input
                type="date"
                value={evalForm.baseDate}
                onChange={(e) => setEvalForm((p) => ({ ...p, baseDate: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Operation</label>
              <select
                value={evalForm.operation}
                onChange={(e) => setEvalForm((p) => ({ ...p, operation: e.target.value }))}
                className="w-full h-8 text-sm bg-background border border-border rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {OPERATIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Value</label>
              <Input
                type="number"
                value={evalForm.value}
                onChange={(e) => setEvalForm((p) => ({ ...p, value: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <Button
              size="sm"
              className="w-full gap-1.5"
              disabled={!evalForm.baseDate || evalMut.isPending}
              onClick={() => evalMut.mutate()}
            >
              {evalMut.isPending ? <Spinner size={12} /> : <PlayCircle size={13} />}
              Preview Result
            </Button>
            {evalResult && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-sm">
                <div className="text-xs text-muted-foreground mb-1">Calculated date</div>
                <div className="text-green-400 font-semibold mono text-lg">{fmtDate(evalResult.calculatedDate)}</div>
                <div className="text-xs text-muted-foreground mt-1">from {fmtDate(evalResult.sourceDate)}</div>
              </div>
            )}
          </div>
        </div>

        {/* Executed rules on a contract */}
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <Calendar size={15} className="text-blue-400" />
            <span className="text-sm font-semibold">Rules Fired on Contract</span>
          </div>
          <div className="flex gap-2 mb-3">
            <Input
              placeholder="Request ID (e.g. 92355)"
              value={previewReqId}
              onChange={(e) => setPreviewReqId(e.target.value)}
              className="h-8 text-sm"
            />
            <Button size="sm" variant="outline" onClick={() => refetchExecuted()} className="h-8">Check</Button>
          </div>
          {(executed?.data ?? []).length === 0 && previewReqId && (
            <div className="text-xs text-muted-foreground">No date rules executed on this contract.</div>
          )}
          <div className="space-y-2">
            {(executed?.data ?? []).map((r, i) => (
              <div key={i} className="bg-muted/50 rounded p-2.5 text-xs">
                <div className="font-medium">{r.ruleName}</div>
                <div className="text-muted-foreground mt-0.5">
                  {r.triggeredField} → <span className="text-green-400">{fmtDate(r.resultDate)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Rules list */}
      <div className="flex gap-2 mb-4">
        <select
          value={selAppTypeId ?? ""}
          onChange={(e) => setSelAppTypeId(e.target.value ? Number(e.target.value) : null)}
          className="h-9 text-sm bg-background border border-border rounded-md px-3 focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All app types</option>
          {(appTypes ?? []).map((at) => (
            <option key={at.applicationTypeId} value={at.applicationTypeId}>{at.applicationTypeName}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="h-9">Refresh</Button>
      </div>

      {error && <ErrorAlert message={(error as Error).message} onRetry={() => refetch()} />}
      {isLoading && <div className="flex justify-center py-16"><Spinner size={32} /></div>}
      {!isLoading && rules.length === 0 && (
        <EmptyState
          icon={<Calendar size={32} />}
          title="No date rules found"
          description="Select an app type to filter, or create a new rule."
          action={
            <Button size="sm" onClick={() => setShowCreateModal(true)} className="gap-1.5 mt-2">
              <Plus size={13} />Create New Rule
            </Button>
          }
        />
      )}

      <div className="space-y-2">
        {rules.map((r) => (
          <div key={r.id} className="bg-card border border-border rounded-lg px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">{r.ruleName}</div>
              <div className="text-xs text-muted-foreground mono mt-0.5">
                {r.sourceFieldKey} → {r.operation}({r.value}) → {r.targetFieldKey}
              </div>
              {r.description && (
                <div className="text-xs text-muted-foreground mt-0.5">{r.description}</div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge variant={r.isActive ? "secondary" : "outline"} className="text-[10px]">
                {r.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
          </div>
        ))}
      </div>

      {/* Create Rule Modal */}
      {showCreateModal && (
        <CreateDateRuleModal
          appTypes={appTypes ?? []}
          defaultAppTypeId={selAppTypeId}
          onClose={() => setShowCreateModal(false)}
          onSaved={() => {
            setShowCreateModal(false);
            qc.invalidateQueries({ queryKey: QK.dateRules(tenant) });
          }}
        />
      )}
    </div>
  );
}

// ─── Create Date Rule Modal ────────────────────────────────────────────────────
function CreateDateRuleModal({
  appTypes,
  defaultAppTypeId,
  onClose,
  onSaved,
}: {
  appTypes: Array<{ applicationTypeId: number; applicationTypeName: string }>;
  defaultAppTypeId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const clients = useApiClients();
  const { tenant } = useAuthStore();

  const [form, setForm] = useState({
    ruleName: "",
    applicationTypeId: defaultAppTypeId ?? "",
    sourceFieldKey: "",
    targetFieldKey: "",
    operation: "AddMonths",
    value: 12,
    isActive: true,
  });

  const { data: fields, isLoading: fieldsLoading } = useQuery({
    queryKey: ["dateRuleFields", tenant],
    queryFn: () => listDateRuleFields(clients!.newCloud, tenant),
    enabled: !!clients,
  });

  const fieldList = (fields ?? []) as Array<{ fieldKey: string; displayName: string }>;

  const createMut = useMutation({
    mutationFn: () =>
      createDateRule(clients!.newCloud, tenant, {
        ruleName: form.ruleName,
        applicationTypeId: Number(form.applicationTypeId),
        sourceFieldKey: form.sourceFieldKey,
        targetFieldKey: form.targetFieldKey,
        operation: form.operation,
        value: Number(form.value),
        isActive: form.isActive,
      }),
    onSuccess: () => { toast.success("Date rule created"); onSaved(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = () => {
    if (!form.ruleName.trim()) { toast.error("Rule name is required"); return; }
    if (!form.applicationTypeId) { toast.error("Application type is required"); return; }
    if (!form.sourceFieldKey || !form.targetFieldKey) { toast.error("Source and target fields are required"); return; }
    createMut.mutate();
  };

  const FieldSelect = ({ label, k }: { label: string; k: "sourceFieldKey" | "targetFieldKey" }) => (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">{label} *</label>
      {fieldsLoading ? (
        <div className="flex items-center gap-2 h-9 text-sm text-muted-foreground">
          <Loader2 size={12} className="animate-spin" /> Loading fields…
        </div>
      ) : fieldList.length > 0 ? (
        <select
          value={form[k]}
          onChange={(e) => set(k, e.target.value)}
          className="w-full h-9 text-sm bg-background border border-border rounded-md px-3 focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Select field…</option>
          {fieldList.map((f) => (
            <option key={f.fieldKey} value={f.fieldKey}>{f.displayName || f.fieldKey}</option>
          ))}
        </select>
      ) : (
        <Input
          value={form[k]}
          onChange={(e) => set(k, e.target.value)}
          placeholder="e.g. startDate"
          className="h-9 text-sm"
        />
      )}
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-xl w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-semibold">Create Date Rule</h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
          </div>

          <div className="space-y-3.5">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Rule Name *</label>
              <Input
                value={form.ruleName}
                onChange={(e) => set("ruleName", e.target.value)}
                placeholder="e.g. Auto-calculate Expiry from Start"
                className="h-9 text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1">Application Type *</label>
              <select
                value={form.applicationTypeId}
                onChange={(e) => set("applicationTypeId", e.target.value ? Number(e.target.value) : "")}
                className="w-full h-9 text-sm bg-background border border-border rounded-md px-3 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Select app type…</option>
                {appTypes.map((at) => (
                  <option key={at.applicationTypeId} value={at.applicationTypeId}>
                    {at.applicationTypeName}
                  </option>
                ))}
              </select>
            </div>

            <FieldSelect label="Source Field" k="sourceFieldKey" />
            <FieldSelect label="Target Field" k="targetFieldKey" />

            <div>
              <label className="text-xs text-muted-foreground block mb-1">Operation *</label>
              <select
                value={form.operation}
                onChange={(e) => set("operation", e.target.value)}
                className="w-full h-9 text-sm bg-background border border-border rounded-md px-3 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {OPERATIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1">Value *</label>
              <Input
                type="number"
                value={form.value}
                onChange={(e) => set("value", Number(e.target.value))}
                placeholder="e.g. 12"
                className="h-9 text-sm"
              />
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} className="rounded" />
              <span className="text-sm">Active</span>
            </label>
          </div>

          <div className="flex gap-2 justify-end mt-5 pt-4 border-t border-border">
            <Button variant="outline" size="sm" onClick={onClose} disabled={createMut.isPending}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={createMut.isPending} className="gap-1.5">
              {createMut.isPending && <Loader2 size={12} className="animate-spin" />}
              Create Rule
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
