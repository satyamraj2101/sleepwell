import { useMemo } from "react";
import { useAuthStore } from "@/store/authStore";
import { createOldProdClient, createNewCloudClient } from "@/api/leahClient";

/**
 * Returns typed axios clients for Old Prod and New Cloud APIs.
 * Throws if not connected. Use inside TanStack Query queryFn.
 */
export function useApiClients() {
  const token = useAuthStore((s) => s.token);
  const cloudInstance = useAuthStore((s) => s.cloudInstance);
  const newCloudApi = useAuthStore((s) => s.newCloudApi);
  const tenant = useAuthStore((s) => s.tenant);

  return useMemo(() => {
    if (!token) return null;
    return {
      oldProd: createOldProdClient(cloudInstance, token, tenant),
      newCloud: createNewCloudClient(newCloudApi, token, tenant),
    };
  }, [token, cloudInstance, newCloudApi, tenant]);
}

export function useRequiredClients() {
  const clients = useApiClients();
  if (!clients) throw new Error("Not connected. Open settings to connect.");
  return clients;
}
