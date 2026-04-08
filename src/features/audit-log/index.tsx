import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Spinner, EmptyState, ErrorAlert } from "@/components/shared/PageHeader";
import { useApiClients } from "@/hooks/useApiClients";
import { useAuthStore } from "@/store/authStore";
import { queryAuditLog } from "@/api/auditLog";
import { QK, fmtDate } from "@/lib/utils";
import * as XLSX from "xlsx";

export default function AuditLogPage() {
  const [requestId, setRequestId] = useState("");
  const [userId, setUserId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const clients = useApiClients();
  const { tenant } = useAuthStore();

  const entityId = requestId ? Number(requestId) : undefined;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...QK.auditLog(tenant, entityId ?? 0), userId, fromDate, toDate],
    queryFn: () =>
      queryAuditLog(clients!.newCloud, tenant, {
        entityId,
        userId: userId ? Number(userId) : undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        pageSize: 200,
      }),
    enabled: !!clients && submitted && (!!entityId || !!userId),
  });

  const entries = data?.data ?? [];

  const exportXlsx = () => {
    if (!entries.length) return;
    const rows = entries.map((e) => ({
      "Audit ID": e.auditLogId,
      "Entity ID": e.entityId,
      "Action": e.action,
      "Field": e.fieldName,
      "Old Value": e.oldValue ?? "",
      "New Value": e.newValue ?? "",
      "By": e.performedBy,
      "On": fmtDate(e.performedOn),
      "Description": e.description,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "AuditLog");
    XLSX.writeFile(wb, `audit-log-${entityId ?? userId}-${Date.now()}.xlsx`);
  };

  return (
    <div>
      <PageHeader
        title="Audit Log Viewer"
        description="Query the full action trail for any contract — who changed what, when, and from which value."
        actions={
          <Button variant="outline" size="sm" onClick={exportXlsx} disabled={!entries.length} className="gap-1.5">
            <Download size={13} />Export
          </Button>
        }
      />

      {/* Filter form */}
      <div className="bg-card border border-border rounded-lg p-4 mb-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Request ID</label>
          <Input placeholder="e.g. 92355" value={requestId} onChange={(e) => setRequestId(e.target.value)} className="h-8 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">User ID (optional)</label>
          <Input placeholder="e.g. 1083" value={userId} onChange={(e) => setUserId(e.target.value)} className="h-8 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">From date</label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">To date</label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="col-span-full">
          <Button size="sm" onClick={() => { setSubmitted(true); refetch(); }} disabled={!requestId && !userId} className="gap-1.5">
            <Search size={13} />Query Audit Log
          </Button>
        </div>
      </div>

      {error && <ErrorAlert message={(error as Error).message} onRetry={() => refetch()} />}
      {isLoading && <div className="flex justify-center py-20"><Spinner size={32} /></div>}
      {submitted && !isLoading && entries.length === 0 && (
        <EmptyState title="No audit entries found" description="Try a different request ID, user ID, or date range." />
      )}

      {entries.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-muted/50 border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
            {data?.totalRecords ?? entries.length} entries
          </div>
          <div className="divide-y divide-border">
            {entries.map((e) => (
              <div key={e.auditLogId} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                <div className="flex items-start justify-between gap-4 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold bg-muted px-2 py-0.5 rounded">{e.action}</span>
                    {e.fieldName && <span className="text-xs text-muted-foreground mono">{e.fieldName}</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground mono flex-shrink-0">{fmtDate(e.performedOn)}</div>
                </div>
                {(e.oldValue || e.newValue) && (
                  <div className="flex items-center gap-2 text-xs mb-1">
                    {e.oldValue && <span className="line-through text-red-400 bg-red-500/10 px-2 py-0.5 rounded">{e.oldValue}</span>}
                    {e.oldValue && e.newValue && <span className="text-muted-foreground">→</span>}
                    {e.newValue && <span className="text-green-400 bg-green-500/10 px-2 py-0.5 rounded">{e.newValue}</span>}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  By <span className="text-foreground">{e.performedBy}</span>
                  {e.description && <span> · {e.description}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
