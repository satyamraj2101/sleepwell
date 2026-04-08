import { AxiosInstance } from "axios";
import { ComplianceScoreCard } from "@/types";

export async function getScoreCard(client: AxiosInstance, tenant: string, requestId: number): Promise<ComplianceScoreCard> {
  const res = await client.get<ComplianceScoreCard>(`/api/${tenant}/compare-comply/score-card`, { params: { requestId } });
  return res.data;
}

export async function runAI(client: AxiosInstance, tenant: string, payload: { requestId: number; versionId?: number }): Promise<void> {
  await client.post(`/api/${tenant}/compare-comply/run-ai`, payload);
}

export async function processRequest(client: AxiosInstance, tenant: string, id: number): Promise<void> {
  await client.post(`/api/${tenant}/compare-comply/process-request`, null, { params: { id } });
}

export async function loadCompareTab(client: AxiosInstance, tenant: string, requestId: number): Promise<unknown> {
  const res = await client.get(`/api/${tenant}/compare-comply/load-tab`, { params: { requestId } });
  return res.data;
}

export async function lockObligationItem(client: AxiosInstance, tenant: string, itemId: number, state: boolean): Promise<unknown> {
  const res = await client.post(`/api/${tenant}/compare-comply/request-item/lock`, null, { params: { ItemId: itemId, State: state } });
  return res.data;
}

export async function getExtractionHistory(client: AxiosInstance, tenant: string, classificationItemId: number, isClassification: boolean): Promise<unknown[]> {
  const res = await client.get(`/api/${tenant}/compare-comply/extraction-history`, { params: { classificationItemId, isClassification } });
  return res.data ?? [];
}
