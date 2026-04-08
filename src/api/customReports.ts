import { AxiosInstance } from "axios";
import { CustomReport, ReportDataResponse } from "@/types";

export async function listReports(client: AxiosInstance, tenant: string): Promise<CustomReport[]> {
  const res = await client.get(`/api/${tenant}/custom-reports`);
  return res.data?.data ?? res.data ?? [];
}

export async function getReportData(
  client: AxiosInstance,
  tenant: string,
  reportId: number,
  params?: { pageNo?: number; recordsPerPage?: number; fromDate?: string; toDate?: string }
): Promise<ReportDataResponse> {
  const res = await client.get(`/api/${tenant}/custom-report/${reportId}/data`, {
    params: { PageNo: params?.pageNo ?? 1, RecordsPerPage: params?.recordsPerPage ?? 50, ...params },
  });
  return res.data;
}

export async function createReport(client: AxiosInstance, tenant: string, payload: unknown): Promise<number> {
  const res = await client.post(`/api/${tenant}/custom-report`, payload);
  return res.data?.data ?? res.data;
}

export async function updateReport(client: AxiosInstance, tenant: string, id: number, payload: unknown): Promise<number> {
  const res = await client.put(`/api/${tenant}/custom-report/${id}`, payload);
  return res.data?.data ?? res.data;
}

export async function deleteReport(client: AxiosInstance, tenant: string, id: number): Promise<void> {
  await client.delete(`/api/${tenant}/custom-report/${id}`);
}

export async function scheduleReport(client: AxiosInstance, tenant: string, payload: unknown): Promise<number> {
  const res = await client.post(`/api/${tenant}/custom-report/schedule-report`, payload);
  return res.data?.data ?? res.data;
}

export async function getReportFields(client: AxiosInstance, tenant: string, payload: { applicationId: number; applicationTypeId: number[] }): Promise<unknown> {
  const res = await client.post(`/api/${tenant}/custom-report/fields`, payload);
  return res.data;
}

export async function getContractStatuses(client: AxiosInstance, tenant: string, applicationTypeIds: number[]): Promise<unknown[]> {
  const res = await client.post(`/api/${tenant}/custom-report/contract-status`, { applicationTypeId: applicationTypeIds });
  return res.data ?? [];
}
