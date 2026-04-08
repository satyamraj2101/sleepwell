import { AxiosInstance } from "axios";
import { BulkImportTemplate } from "@/types";

export async function listBulkImportTemplates(
  client: AxiosInstance,
  tenant: string,
  params?: { pageNumber?: number; pageSize?: number; search?: string }
): Promise<BulkImportTemplate[]> {
  const res = await client.get(`/api/${tenant}/bulk-import-template/get-all-bulkimport-template`, {
    params: { PageNumber: params?.pageNumber ?? 1, PageSize: params?.pageSize ?? 50, ...params },
  });
  return res.data?.data ?? res.data ?? [];
}

// Returns blob for download
export async function downloadBulkTemplate(
  client: AxiosInstance,
  tenant: string,
  params: { applicationTypeId: number; contractTemplateId?: number; contractTemplateName?: string; rowCount?: number }
): Promise<Blob> {
  const res = await client.get(`/api/${tenant}/bulk-import-template/download`, {
    params: { ApplicationTypeId: params.applicationTypeId, ContractTemplateId: params.contractTemplateId, ContractTemplateName: params.contractTemplateName, RowCount: params.rowCount ?? 50 },
    responseType: "blob",
  });
  return res.data;
}

export async function createBulkTemplate(client: AxiosInstance, tenant: string, payload: unknown): Promise<unknown> {
  const res = await client.post(`/api/${tenant}/bulk-import-template`, payload);
  return res.data;
}

export async function updateBulkTemplate(client: AxiosInstance, tenant: string, id: number, payload: unknown): Promise<unknown> {
  const res = await client.put(`/api/${tenant}/bulk-import-template/${id}`, payload);
  return res.data;
}

export async function bulkDeleteTemplates(client: AxiosInstance, tenant: string, ids: string): Promise<void> {
  await client.delete(`/api/${tenant}/bulk-import-template/delete-bulk-contract-template`, { params: { contractTemplateIds: ids } });
}
