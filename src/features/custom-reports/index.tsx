import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, BarChart3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Spinner, EmptyState, ErrorAlert } from "@/components/shared/PageHeader";
import { useApiClients } from "@/hooks/useApiClients";
import { useAuthStore } from "@/store/authStore";
import { listReports, getReportData } from "@/api/customReports";
import { QK, fmtDate } from "@/lib/utils";
import * as XLSX from "xlsx";

export default function CustomReportsPage() {
  const [selReportId, setSelReportId] = useState<number | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  const clients = useApiClients();
  const { tenant } = useAuthStore();

  const { data: reports, isLoading: rLoading, error: rError } = useQuery({
    queryKey: QK.reports(tenant),
    queryFn: () => listReports(clients!.newCloud, tenant),
    enabled: !!clients,
  });

  const { data: reportData, isLoading: dLoading, refetch: refetchData } = useQuery({
    queryKey: ["reportData", tenant, selReportId, page, fromDate, toDate],
    queryFn: () => getReportData(clients!.newCloud, tenant, selReportId!, {
      pageNo: page,
      recordsPerPage: 50,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    }),
    enabled: !!clients && !!selReportId,
  });

  const rows = reportData?.data ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  const exportXlsx = () => {
    if (!rows.length) return;
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `report-${selReportId}-${Date.now()}.xlsx`);
  };

  return (
    <div>
      <PageHeader
        title="Custom Report Builder & Scheduler"
        description="Browse and fetch report data. Export as Excel or push to downstream systems."
        actions={
          <Button variant="outline" size="sm" onClick={exportXlsx} disabled={!rows.length} className="gap-1.5">
            <Download size={13} />Export Excel
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Report list */}
        <div className="lg:col-span-1">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Reports ({(reports ?? []).length})</div>
          {rLoading && <Spinner size={20} />}
          {rError && <ErrorAlert message={(rError as Error).message} />}
          <div className="space-y-1.5">
            {(reports ?? []).map((r) => (
              <button key={r.reportId} onClick={() => { setSelReportId(r.reportId); setPage(1); }}
                className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${selReportId === r.reportId ? "border-amber-500/60 bg-amber-500/5" : "border-border bg-card hover:border-border/80"}`}>
                <div className="font-medium truncate">{r.reportName}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(r.createdOn)}</div>
              </button>
            ))}
            {!rLoading && (reports ?? []).length === 0 && (
              <div className="text-xs text-muted-foreground">No reports found</div>
            )}
          </div>
        </div>

        {/* Report data */}
        <div className="lg:col-span-3">
          {!selReportId && (
            <EmptyState icon={<BarChart3 size={32} />} title="Select a report" description="Choose a report from the left panel to view its data." />
          )}

          {selReportId && (
            <>
              <div className="flex flex-wrap gap-2 mb-4">
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 text-sm w-36" placeholder="From" />
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 text-sm w-36" placeholder="To" />
                <Button size="sm" variant="outline" onClick={() => { setPage(1); refetchData(); }} className="gap-1.5 h-8">
                  <RefreshCw size={12} />Refresh
                </Button>
                <span className="text-xs text-muted-foreground self-center">{reportData?.totalRecords ?? 0} records</span>
              </div>

              {dLoading && <div className="flex justify-center py-10"><Spinner size={28} /></div>}

              {!dLoading && rows.length === 0 && (
                <EmptyState title="No data" description="Adjust the date range or check the report configuration." />
              )}

              {!dLoading && rows.length > 0 && (
                <div className="border border-border rounded-lg overflow-x-auto scrollbar-thin">
                  <table className="w-full text-xs min-w-[800px]">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        {columns.map(c => <th key={c} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                          {columns.map(c => <td key={c} className="px-3 py-2 whitespace-nowrap">{String(row[c] ?? "")}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(reportData?.totalRecords ?? 0) > 50 && (
                <div className="flex justify-center gap-2 mt-3">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                  <span className="text-xs text-muted-foreground self-center">Page {page}</span>
                  <Button variant="outline" size="sm" disabled={rows.length < 50} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
