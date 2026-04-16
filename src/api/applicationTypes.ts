import { AxiosInstance } from "axios";
import { ApplicationType } from "@/types";

// GET /api/{tenant}/v1/applicationtype — Old Prod API
export async function listApplicationTypes(
  client: AxiosInstance,
  tenant: string,
  requestorUsername: string,
  params?: { pageNo?: number; perPage?: number; search?: string; applicationTypeId?: number }
): Promise<ApplicationType[]> {
  const res = await client.get(`/api/${tenant}/v1/applicationtype`, {
    params: {
      "filter.pageNo": params?.pageNo ?? 1,
      "filter.perPage": params?.perPage ?? 100,
      "filter.requestorUsername": requestorUsername,
      ...(params?.search && { "filter.search": params.search }),
      ...(params?.applicationTypeId && { "filter.applicationTypeId": params.applicationTypeId }),
    },
    headers: {
      'tenant': tenant,
      'x-tenant-name': tenant
    }
  });
  const raw = res.data;
  // Handles: raw array, { data: [] }, { data: { data: [] } }, { items: [] }
  const inner = raw?.data ?? raw;
  return Array.isArray(inner)
    ? inner
    : Array.isArray(inner?.data)
    ? inner.data
    : Array.isArray(inner?.items)
    ? inner.items
    : [];
}

// GET /api/{tenant}/application-type — New Cloud API (stg5 full CRUD version)
export async function listApplicationTypesNew(
  client: AxiosInstance,
  tenant: string,
  params?: { pageNumber?: number; pageSize?: number; search?: string }
): Promise<{ data: ApplicationType[]; totalRecords: number }> {
  const res = await client.get(`/api/${tenant}/application-type`, {
    params: {
      PageNumber: params?.pageNumber ?? 1,
      PageSize: params?.pageSize ?? 100,
      ...(params?.search && { Search: params.search }),
    },
  });
  return res.data;
}

// GET /api/{tenant}/application-type/{id} — New Cloud API
export async function getApplicationTypeById(
  client: AxiosInstance,
  tenant: string,
  appTypeId: number
): Promise<ApplicationType> {
  const res = await client.get(`/api/${tenant}/application-type/${appTypeId}`);
  return res.data.data ?? res.data;
}

// POST /api/{tenant}/application-type — New Cloud API
export async function createApplicationType(
  client: AxiosInstance,
  tenant: string,
  payload: unknown
): Promise<number> {
  const res = await client.post(`/api/${tenant}/application-type`, payload);
  return res.data;
}

// PUT /api/{tenant}/application-type/{id} — New Cloud API
export async function updateApplicationType(
  client: AxiosInstance,
  tenant: string,
  appTypeId: number,
  payload: unknown
): Promise<number> {
  const res = await client.put(`/api/${tenant}/application-type/${appTypeId}`, payload);
  return res.data;
}

// DELETE /api/{tenant}/application-type/{id}
export async function deleteApplicationType(
  client: AxiosInstance,
  tenant: string,
  appTypeId: number
): Promise<void> {
  await client.delete(`/api/${tenant}/application-type/${appTypeId}`);
}

// POST /api/{tenant}/application-type/bulk-delete
export async function bulkDeleteApplicationTypes(
  client: AxiosInstance,
  tenant: string,
  ids: number[]
): Promise<void> {
  await client.post(`/api/${tenant}/application-type/bulk-delete`, ids);
}

// GET /api/{tenant}/application-type/{id}/contract-template
export async function getContractTemplates(
  client: AxiosInstance,
  tenant: string,
  appTypeId: number,
  params?: { isBulkImport?: boolean; pageSize?: number; search?: string }
): Promise<unknown[]> {
  const res = await client.get(
    `/api/${tenant}/application-type/${appTypeId}/contract-template`,
    {
      params: {
        IsBulkImport: params?.isBulkImport,
        PageSize: params?.pageSize ?? 50,
        Search: params?.search,
      },
    }
  );
  return res.data?.data ?? [];
}
