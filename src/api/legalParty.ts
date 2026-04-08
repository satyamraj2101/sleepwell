// src/api/legalParty.ts
import { AxiosInstance } from "axios";
import { LegalParty, LegalPartyListResponse, CreateLegalPartyPayload } from "@/types";

export async function listLegalParties(
  client: AxiosInstance,
  tenant: string,
  params?: { pageNo?: number; perPage?: number; search?: string; isActive?: boolean; direction?: boolean; sortOn?: string }
): Promise<LegalPartyListResponse> {
  const res = await client.get(`/api/${tenant}/legal-party`, {
    params: {
      PageNo: params?.pageNo ?? 1,
      PerPage: params?.perPage ?? 50,
      ...(params?.search && { Search: params.search }),
      ...(params?.isActive !== undefined && { IsActive: params.isActive }),
      ...(params?.direction !== undefined && { Direction: params.direction }),
      ...(params?.sortOn && { SortOn: params.sortOn }),
    },
  });
  return res.data;
}

export async function getLegalPartyById(client: AxiosInstance, tenant: string, id: number): Promise<LegalParty> {
  const res = await client.get(`/api/${tenant}/legal-party/${id}`);
  return res.data;
}

export async function createLegalParty(client: AxiosInstance, tenant: string, payload: CreateLegalPartyPayload): Promise<number> {
  const res = await client.post(`/api/${tenant}/legal-party`, payload);
  return res.data;
}

export async function updateLegalParty(client: AxiosInstance, tenant: string, id: number, payload: CreateLegalPartyPayload): Promise<number> {
  const res = await client.put(`/api/${tenant}/legal-party/${id}`, payload);
  return res.data;
}

export async function deleteLegalParty(client: AxiosInstance, tenant: string, id: number): Promise<void> {
  await client.delete(`/api/${tenant}/legal-party/${id}`);
}

export async function bulkDeleteLegalParties(client: AxiosInstance, tenant: string, ids: number[]): Promise<boolean> {
  const res = await client.post(`/api/${tenant}/legal-party/bulk-delete`, ids);
  return res.data;
}
