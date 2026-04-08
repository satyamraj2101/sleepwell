import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Spinner, EmptyState, ErrorAlert } from "@/components/shared/PageHeader";
import { useApiClients } from "@/hooks/useApiClients";
import { useAuthStore } from "@/store/authStore";
import { useAppTypes } from "@/features/contract-edit/hooks";
import { listBulkImportTemplates, downloadBulkTemplate } from "@/api/bulkImport";
import { getContractTemplates } from "@/api/applicationTypes";
import { QK, downloadBlob } from "@/lib/utils";

export default function BulkImportPage() {
  const [selAppTypeId, setSelAppTypeId] = useState<number | null>(null);
  const [rowCount, setRowCount] = useState("50");
  const [downloading, setDownloading] = useState(false);

  const clients = useApiClients();
  const { tenant } = useAuthStore();
  const { data: appTypes } = useAppTypes();

  const { data: templates, isLoading, error } = useQuery({
    queryKey: QK.bulkTemplates(tenant),
    queryFn: () => listBulkImportTemplates(clients!.newCloud, tenant),
    enabled: !!clients,
  });

  const { data: contractTemplates } = useQuery({
    queryKey: ["contractTemplates", tenant, selAppTypeId],
    queryFn: () => getContractTemplates(clients!.newCloud, tenant, selAppTypeId!, { isBulkImport: true }),
    enabled: !!clients && !!selAppTypeId,
  });

  const handleDownload = async () => {
    if (!selAppTypeId) { toast.error("Select an app type first"); return; }
    setDownloading(true);
    try {
      const blob = await downloadBulkTemplate(clients!.newCloud, tenant, {
        applicationTypeId: selAppTypeId,
        rowCount: Number(rowCount),
      });
      const at = (appTypes ?? []).find(a => a.applicationTypeId === selAppTypeId);
      downloadBlob(blob, `bulk-import-${at?.applicationTypeName ?? selAppTypeId}-${Date.now()}.xlsx`);
      toast.success("Template downloaded");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Bulk Import Template Tool"
        description="Download pre-formatted Excel templates for any app type, validate fields, and prepare mass contract imports."
      />

      {/* Download panel */}
      <div className="bg-card border border-border rounded-lg p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <FileSpreadsheet size={15} className="text-green-500" />
          <span className="text-sm font-semibold">Download Template</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Application Type *</label>
            <select value={selAppTypeId ?? ""} onChange={(e) => setSelAppTypeId(e.target.value ? Number(e.target.value) : null)} className="w-full h-9 text-sm bg-background border border-border rounded-md px-3 focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">Select app type…</option>
              {(appTypes ?? []).map((at) => <option key={at.applicationTypeId} value={at.applicationTypeId}>{at.applicationTypeName}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Pre-fill rows</label>
            <Input type="number" min="1" max="500" value={rowCount} onChange={(e) => setRowCount(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="flex items-end">
            <Button className="w-full h-9 gap-1.5" onClick={handleDownload} disabled={!selAppTypeId || downloading}>
              {downloading ? <Spinner size={13} /> : <Download size={13} />}
              Download Excel Template
            </Button>
          </div>
        </div>

        {/* Contract templates available */}
        {(contractTemplates ?? []).length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-2">Contract templates available for this app type:</div>
            <div className="flex flex-wrap gap-2">
              {(contractTemplates ?? []).map((t: any) => (
                <span key={t.contractTemplateId} className="text-xs bg-muted px-2.5 py-1 rounded border border-border">{t.contractTemplateName}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Existing templates */}
      <div className="mb-3 text-sm font-medium">Existing import templates ({(templates ?? []).length})</div>
      {error && <ErrorAlert message={(error as Error).message} />}
      {isLoading && <div className="flex justify-center py-10"><Spinner size={28} /></div>}
      {!isLoading && (templates ?? []).length === 0 && <EmptyState icon={<FileSpreadsheet size={28} />} title="No templates found" />}

      <div className="space-y-2">
        {(templates ?? []).map((t) => (
          <div key={t.id} className="bg-card border border-border rounded-lg px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">{t.templateName}</div>
              <div className="text-xs text-muted-foreground">{t.applicationTypeName} · ID: {t.id}</div>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => {
              downloadBulkTemplate(clients!.newCloud, tenant, { applicationTypeId: t.applicationTypeId, rowCount: 50 })
                .then(blob => downloadBlob(blob, `${t.templateName}.xlsx`))
                .catch(e => toast.error((e as Error).message));
            }}>
              <Download size={12} />Download
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
