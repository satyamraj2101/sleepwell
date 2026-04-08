import { AxiosInstance } from "axios";
import { DateRule, DateRuleEvaluateRequest, DateRuleEvaluateResponse } from "@/types";

export async function listDateRules(
  client: AxiosInstance,
  tenant: string,
  params?: { applicationTypeId?: number; ruleType?: number; isActive?: boolean; search?: string; pageNumber?: number; pageSize?: number }
): Promise<{ data: DateRule[]; totalRecords: number }> {
  const res = await client.get(`/api/${tenant}/date-rules`, { params: { PageNumber: params?.pageNumber ?? 1, PageSize: params?.pageSize ?? 50, ...params } });
  return res.data;
}

export async function getDateRuleById(client: AxiosInstance, tenant: string, id: number): Promise<DateRule> {
  const res = await client.get(`/api/${tenant}/date-rules/${id}`);
  return res.data?.data ?? res.data;
}

export async function createDateRule(client: AxiosInstance, tenant: string, payload: Partial<DateRule>): Promise<number> {
  const res = await client.post(`/api/${tenant}/date-rules`, payload);
  return res.data?.data ?? res.data;
}

export async function updateDateRule(client: AxiosInstance, tenant: string, id: number, payload: Partial<DateRule>): Promise<number> {
  const res = await client.put(`/api/${tenant}/date-rules/${id}`, payload);
  return res.data?.data ?? res.data;
}

export async function evaluateDateRule(
  client: AxiosInstance,
  tenant: string,
  payload: DateRuleEvaluateRequest
): Promise<DateRuleEvaluateResponse> {
  const res = await client.post(`/api/${tenant}/date-rules/evaluate-date-calculation-rule`, payload);
  return res.data;
}

export async function getExecutedRules(
  client: AxiosInstance,
  tenant: string,
  requestId: number
): Promise<{ data: Array<{ ruleName: string; triggeredField: string; resultDate: string; executedOn: string }> }> {
  const res = await client.get(`/api/${tenant}/date-rules/get-request-executed`, { params: { requestId } });
  return res.data;
}

export async function listDateRuleFields(client: AxiosInstance, tenant: string): Promise<unknown[]> {
  const res = await client.get(`/api/${tenant}/date-rules/fields`);
  return res.data?.data ?? [];
}
