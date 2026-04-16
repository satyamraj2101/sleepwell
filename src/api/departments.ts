import { AxiosInstance } from "axios";
import { Department } from "@/types";

export async function listDepartments(
  client: AxiosInstance,
  tenant: string,
  params?: { search?: string; isActive?: boolean; pageNumber?: number; pageSize?: number }
): Promise<{ data: Department[]; totalRecords: number }> {
  const res = await client.get(`/api/${tenant}/department`, {
    params: { PageNumber: params?.pageNumber ?? 1, PageSize: params?.pageSize ?? 200, IsActive: params?.isActive, Search: params?.search },
    headers: { tenant: tenant.toLowerCase(), "x-tenant-name": tenant.toLowerCase() }
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
    headers: { tenant: tenant.toLowerCase(), "x-tenant-name": tenant.toLowerCase() }
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
  const res = await client.get(`/api/${tenant}/currency`, {
    params: { PageNumber: 1, PageSize: 500 },
    headers: { tenant: tenant.toLowerCase(), "x-tenant-name": tenant.toLowerCase() }
  });
  const raw = res.data;
  const items = Array.isArray(raw) ? raw : (raw?.data ?? raw?.items ?? []);
  
  return (items as any[]).map(c => ({
    currencyId: c.id,
    currencyName: c.name,
    currencyCode: c.code,
    symbol: c.symbol || null
  }));
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
    headers: { tenant: tenant.toLowerCase(), "x-tenant-name": tenant.toLowerCase() }
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
    headers: { tenant: tenant.toLowerCase(), "x-tenant-name": tenant.toLowerCase() }
  });
  const d = res.data;
  return d?.data ?? d?.items ?? (Array.isArray(d) ? d : []);
}
