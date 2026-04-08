import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Lock, Unlock, PlayCircle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Spinner, EmptyState, StatCard } from "@/components/shared/PageHeader";
import { useApiClients } from "@/hooks/useApiClients";
import { useAuthStore } from "@/store/authStore";
import { getScoreCard, runAI, lockObligationItem } from "@/api/compareComply";
import { QK } from "@/lib/utils";

export default function CompareComplyPage() {
  const [reqInput, setReqInput] = useState("");
  const [requestId, setRequestId] = useState<number | null>(null);
  const clients = useApiClients();
  const { tenant } = useAuthStore();

  const { data: scoreCard, isLoading, refetch } = useQuery({
    queryKey: QK.scoreCard(tenant, requestId ?? 0),
    queryFn: () => getScoreCard(clients!.newCloud, tenant, requestId!),
    enabled: !!clients && !!requestId,
  });

  const runAIMut = useMutation({
    mutationFn: () => runAI(clients!.newCloud, tenant, { requestId: requestId! }),
    onSuccess: () => { toast.success("AI run triggered — refresh in a few seconds"); refetch(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const lockMut = useMutation({
    mutationFn: ({ itemId, state }: { itemId: number; state: boolean }) => lockObligationItem(clients!.newCloud, tenant, itemId, state),
    onSuccess: () => { toast.success("Obligation updated"); refetch(); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div>
      <PageHeader
        title="Compare & Comply Dashboard"
        description="View AI obligation extraction results and compliance score cards for any contract."
      />

      <div className="flex gap-2 mb-5">
        <Input placeholder="Enter Request ID (e.g. 92355)" value={reqInput} onChange={(e) => setReqInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setRequestId(Number(reqInput.trim()))} className="h-9 max-w-xs" />
        <Button size="sm" onClick={() => setRequestId(Number(reqInput.trim()))} disabled={!reqInput} className="gap-1.5 h-9"><Search size={13} />Load Score Card</Button>
        {requestId && (
          <Button size="sm" variant="outline" onClick={() => runAIMut.mutate()} disabled={runAIMut.isPending} className="gap-1.5 h-9">
            <PlayCircle size={13} />Run AI
          </Button>
        )}
      </div>

      {isLoading && <div className="flex justify-center py-20"><Spinner size={32} /></div>}

      {!requestId && !isLoading && (
        <EmptyState title="Enter a Request ID" description="Load the compliance score card for any contract to view obligations and compliance status." />
      )}

      {scoreCard && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            <StatCard label="Overall score" value={`${scoreCard.overallScore ?? 0}%`} />
            <StatCard label="Total obligations" value={scoreCard.totalObligations ?? 0} />
            <StatCard label="Compliant" value={scoreCard.compliantCount ?? 0} className="border border-green-500/30" />
            <StatCard label="Non-compliant" value={scoreCard.nonCompliantCount ?? 0} className="border border-red-500/30" />
          </div>

          {/* Obligations list */}
          {(scoreCard.obligations?.length ?? 0) === 0 ? (
            <EmptyState title="No obligations found" description="Run the AI extraction first to populate this score card." />
          ) : (
            <div className="space-y-2">
              {scoreCard.obligations?.map((ob) => (
                <div key={ob.itemId} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      {ob.isCompliant ? <CheckCircle2 size={14} className="text-green-500" /> : <XCircle size={14} className="text-red-500" />}
                      <span className="text-sm font-medium">{ob.obligationName}</span>
                      {ob.isDraft && <Badge variant="outline" className="text-[9px]">Draft</Badge>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => lockMut.mutate({ itemId: ob.itemId, state: !ob.isLocked })}
                        className="p-1 text-muted-foreground hover:text-foreground rounded"
                        title={ob.isLocked ? "Unlock" : "Lock"}
                      >
                        {ob.isLocked ? <Lock size={12} className="text-amber-500" /> : <Unlock size={12} />}
                      </button>
                    </div>
                  </div>
                  {ob.extractedText && (
                    <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2 leading-relaxed">{ob.extractedText}</p>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-2">Updated by {ob.lastUpdatedBy}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
