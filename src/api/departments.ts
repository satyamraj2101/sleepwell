import { AxiosInstance } from "axios";
import { Department } from "@/types";

export async function listDepartments(
  client: AxiosInstance,
  tenant: string,
  params?: { search?: string; isActive?: boolean; pageNumber?: number; pageSize?: number }
): Promise<{ data: Department[]; totalRecords: number }> {
  const res = await client.get(`/api/${tenant}/department`, {
    params: { PageNumber: params?.pageNumber ?? 1, PageSize: params?.pageSize ?? 200, IsActive: params?.isActive, Search: params?.search },
  });
  const d = res.data;
  if (Array.isArray(d)) return { data: d, totalRecords: d.length };
  return { data: d.data ?? d.items ?? [], totalRecords: d.totalRecords ?? 0 };
}

export async function listRecordClassifications(
  client: AxiosInstance,
  tenant: string
): Promise<Array<{ id: number; name: string }>> {
  const res = await client.get(`/api/${tenant}/Master/recordclassification`, {
    params: { PageSize: 500 },
  });
  const d = res.data;
  const arr = d?.data ?? d?.items ?? (Array.isArray(d) ? d : []);
  return arr.map((x: any) => ({
    id: Number(x.recordClassificationId ?? x.id),
    name: String(x.recordClassificationName ?? x.name)
  }));
}

export interface Currency {
  currencyId: number;
  currencyName: string;
  currencyCode: string;
  symbol: string | null;
}

export async function listCurrencies(
  client: AxiosInstance,
  tenant: string
): Promise<Currency[]> {
  const res = await client.get(`/api/${tenant}/Master/currency`, {
    params: { PageSize: 500 },
  });
  const d = res.data;
  return d?.data ?? d?.items ?? (Array.isArray(d) ? d : []);
}

export interface Country {
  countryId: number;
  countryName: string;
  countryCode?: string;
}

export async function listCountries(
  client: AxiosInstance,
  tenant: string
): Promise<Country[]> {
  const res = await client.get(`/api/${tenant}/Master/country`, {
    params: { PageSize: 300 },
  });
  const d = res.data;
  return d?.data ?? d?.items ?? (Array.isArray(d) ? d : []);
}

export async function listApplicationsDropdown(
  client: AxiosInstance,
  tenant: string
): Promise<Array<{ applicationId: number; applicationName: string }>> {
  const res = await client.get(`/api/${tenant}/application`, {
    params: { PageSize: 100 },
  });
  const d = res.data;
  return d?.data ?? d?.items ?? (Array.isArray(d) ? d : []);
}
