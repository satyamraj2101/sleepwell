import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { useAuthStore } from "@/store/authStore";

// ─── Three separate axios instances — one per API base ────────────────────────
// All three call the Leah servers DIRECTLY (no Vite proxy).
// Access-Control-Allow-Origin: * is set on all Leah API responses so the
// browser allows direct cross-origin calls — no proxy needed.

/**
 * Auth API client — POST /cpaimt_auth/auth/token
 * Target: https://{cloudInstance}/cpaimt_auth/auth/token
 */
export function createAuthClient(cloudInstance: string): AxiosInstance {
  return axios.create({
    baseURL: `https://${cloudInstance}/cpaimt_auth`,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

/**
 * Old Prod API client — users, roles, departments, applicationtype, snapshot
 * Target: https://{cloudInstance}/cpaimt_api/api/{tenant}/...
 */
export function createOldProdClient(cloudInstance: string, token: string, tenant: string): AxiosInstance {
  const instance = axios.create({
    baseURL: `https://${cloudInstance}/cpaimt_api`,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Tenant": tenant,
      "x-tenant-name": tenant,
    },
  });
  addTokenExpiryInterceptor(instance);
  addErrorInterceptor(instance);
  return instance;
}

/**
 * New Cloud API client — contracts, metadata, legal-party, etc.
 * Target: https://{newCloudApi}/api/{tenant}/...
 */
export function createNewCloudClient(newCloudApi: string, token: string, tenant: string): AxiosInstance {
  const instance = axios.create({
    baseURL: `https://${newCloudApi}`,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Tenant": tenant,
      "x-tenant-name": tenant,
    },
  });
  addTokenExpiryInterceptor(instance);
  addErrorInterceptor(instance);
  return instance;
}

// ─── Token expiry interceptor ────────────────────────────────────────────────
function addTokenExpiryInterceptor(instance: AxiosInstance) {
  instance.interceptors.request.use(async (config) => {
    const store = useAuthStore.getState();
    if (store.isTokenExpired()) {
      console.warn("API Request while token missing/expired.");
    }
    return config;
  });
}

// ─── Error interceptor ────────────────────────────────────────────────────────
function addErrorInterceptor(instance: AxiosInstance) {
  instance.interceptors.response.use(
    (res) => res,
    (err) => {
      if (err.response?.status === 401) {
        throw new LeahAuthError("Session expired or unauthorized. Please re-connect via settings.");
      }
      if (err.response?.status === 403) {
        throw new LeahForbiddenError(
          `Access denied: ${err.config?.url ?? "unknown endpoint"}`
        );
      }
      const detail =
        err.response?.data?.detail ||
        err.response?.data?.Detail ||
        err.response?.data?.message ||
        err.response?.data?.Message ||
        err.message;
      throw new LeahApiError(
        `API error ${err.response?.status ?? "unknown"}: ${detail}`,
        err.response?.status,
        err.response?.data
      );
    }
  );
}

// ─── Custom error classes ─────────────────────────────────────────────────────
export class LeahApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseData?: unknown
  ) {
    super(message);
    this.name = "LeahApiError";
  }
}

export class LeahAuthError extends LeahApiError {
  constructor(message: string) {
    super(message, 401);
    this.name = "LeahAuthError";
  }
}

export class LeahForbiddenError extends LeahApiError {
  constructor(message: string) {
    super(message, 403);
    this.name = "LeahForbiddenError";
  }
}

// ─── Hook to get typed API clients from current store state ──────────────────
export function useApiClients() {
  const store = useAuthStore.getState();
  const { cloudInstance, newCloudApi, token, tenant } = store;
  if (!token) throw new LeahAuthError("Not connected. Open settings to connect.");
  return {
    oldProd: createOldProdClient(cloudInstance, token, tenant),
    newCloud: createNewCloudClient(newCloudApi, token, tenant),
  };
}

// ─── Generic fetch helper with auth ──────────────────────────────────────────
export async function leahGet<T>(
  client: AxiosInstance,
  path: string,
  params?: Record<string, unknown>
): Promise<T> {
  const res = await client.get<T>(path, { params });
  return res.data;
}

export async function leahPost<T>(
  client: AxiosInstance,
  path: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<T> {
  const res = await client.post<T>(path, data, config);
  return res.data;
}

export async function leahPut<T>(
  client: AxiosInstance,
  path: string,
  data?: unknown
): Promise<T> {
  const res = await client.put<T>(path, data);
  return res.data;
}

export async function leahPatch<T>(
  client: AxiosInstance,
  path: string,
  data?: unknown
): Promise<T> {
  const res = await client.patch<T>(path, data);
  return res.data;
}

export async function leahDelete<T>(
  client: AxiosInstance,
  path: string
): Promise<T> {
  const res = await client.delete<T>(path);
  return res.data;
}
