import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPreExecutionApprovals } from "@/api/approval";
import { PageHeader, Spinner, EmptyState, ErrorAlert } from "@/components/shared/PageHeader";
import { useApiClients } from "@/hooks/useApiClients";
import { useAuthStore } from "@/store/authStore";
import { QK, fmtDate } from "@/lib/utils";

const statusIcon = {
  Approved: <CheckCircle2 size={14} className="text-green-500" />,
  Rejected:  <XCircle    size={14} className="text-red-500"   />,
  Pending:   <Clock      size={14} className="text-amber-500" />,
};

const statusBadge: Record<string, string> = {
  Approved: "bg-green-500/15 text-green-500 border-green-500/30",
  Rejected:  "bg-red-500/15 text-red-500 border-red-500/30",
  Pending:   "bg-amber-500/15 text-amber-500 border-amber-500/30",
};

export default function ApprovalCheckerPage() {
  const [reqInput, setReqInput] = useState("");
  const [requestId, setRequestId] = useState<number | null>(null);
  const clients = useApiClients();
  const { tenant } = useAuthStore();

  const { data: approvals, isLoading, error, refetch } = useQuery({
    queryKey: QK.approvals(tenant, requestId ?? 0),
    queryFn: () => getPreExecutionApprovals(clients!.newCloud, tenant, requestId!),
    enabled: !!clients && !!requestId,
  });

  const allApproved = approvals?.data?.approvals?.every((a) => a.status === "Approved") ?? false;
  const blockingCount = approvals?.data?.approvals?.filter((a) => a.status === "Pending").length ?? 0;

  return (
    <div>
      <PageHeader
        title="Pre-Execution Approval Checker"
        description="Verify all approval gates are cleared before sending a contract for e-signature."
      />

      <div className="flex gap-2 mb-5">
        <Input
          placeholder="Enter Request ID (e.g. 92355)"
          value={reqInput}
          onChange={(e) => setReqInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setRequestId(Number(reqInput.trim()))}
          className="h-9 max-w-xs"
        />
        <Button size="sm" onClick={() => setRequestId(Number(reqInput.trim()))} disabled={!reqInput} className="gap-1.5 h-9">
          <Search size={13} />Check Approvals
        </Button>
      </div>

      {error && <ErrorAlert message={(error as Error).message} onRetry={() => refetch()} />}
      {isLoading && <div className="flex justify-center py-20"><Spinner size={32} /></div>}

      {!requestId && !isLoading && (
        <EmptyState title="Enter a Request ID" description="Check which approvals are required before e-signature can be triggered." />
      )}

      {approvals && (
        <>
          {/* Summary banner */}
          <div className={`rounded-lg border p-4 mb-5 flex items-center gap-3 ${allApproved ? "bg-green-500/10 border-green-500/30" : "bg-amber-500/10 border-amber-500/30"}`}>
            {allApproved
              ? <CheckCircle2 size={18} className="text-green-500 flex-shrink-0" />
              : <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />}
            <div>
              <div className="text-sm font-medium">
                {allApproved ? "All approvals cleared — ready for e-signature" : `${blockingCount} approval${blockingCount !== 1 ? "s" : ""} still pending`}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Request #{requestId} · Stage: {approvals.data?.currentStage ?? "—"}
              </div>
            </div>
          </div>

          {/* Approval list */}
          {(approvals.data?.approvals?.length ?? 0) === 0 ? (
            <EmptyState title="No approval requirements" description="This contract has no pre-execution approvals configured." />
          ) : (
            <div className="space-y-2">
              {approvals.data?.approvals?.map((a) => (
                <div key={a.approvalId} className="bg-card border border-border rounded-lg p-4 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    {statusIcon[a.status as keyof typeof statusIcon] ?? <Clock size={14} className="text-muted-foreground" />}
                    <div>
                      <div className="text-sm font-medium">{a.approverName}</div>
                      <div className="text-xs text-muted-foreground">{a.approverRole}</div>
                      {a.condition && <div className="text-xs text-muted-foreground mt-1 mono">Condition: {a.condition}</div>}
                      {a.comments && <div className="text-xs text-muted-foreground mt-1">"{a.comments}"</div>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${statusBadge[a.status] ?? ""}`}>
                      {a.status}
                    </span>
                    {a.actionedOn && <span className="text-[10px] text-muted-foreground">{fmtDate(a.actionedOn)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
