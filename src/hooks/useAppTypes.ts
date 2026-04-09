import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { useApiClients } from "@/hooks/useApiClients";
import { listApplicationTypes } from "@/api/applicationTypes";
import { QK } from "@/lib/utils";

export function useAppTypes() {
  const clients = useApiClients();
  const { tenant, username } = useAuthStore();
  return useQuery({
    queryKey: QK.appTypes(tenant),
    queryFn: () => listApplicationTypes(clients!.oldProd, tenant, username, { perPage: 1000 }),
    enabled: !!clients,
    staleTime: 10 * 60 * 1000, // app types rarely change
  });
}
