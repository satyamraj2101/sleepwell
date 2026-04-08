import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { useApiClients } from "@/hooks/useApiClients";
import { bulkToggleMask, fetchAllUsers } from "@/api/users";
import { QK } from "@/lib/utils";
import { LeahUser, getUserMaskStatus } from "@/types";
import { LeahAuthError } from "@/api/leahClient";

export function useUsers(departmentId?: number) {
  const clients = useApiClients();
  const { tenant, username } = useAuthStore();

  return useQuery({
    queryKey: [...QK.users(tenant, 1), departmentId],
    queryFn: async () => {
      if (!clients) throw new Error("Not connected");
      return fetchAllUsers(clients.oldProd, tenant, username, departmentId);
    },
    enabled: !!clients,
  });
}

export function useUserMaskStats(users: LeahUser[]) {
  const masked   = users.filter((u) => getUserMaskStatus(u) === "masked").length;
  const unmasked = users.filter((u) => getUserMaskStatus(u) === "unmasked").length;
  return { masked, unmasked, total: users.length };
}

export function useBulkMaskMutation() {
  const qc = useQueryClient();
  const clients = useApiClients();
  const { tenant, username, isTokenExpired } = useAuthStore();

  return useMutation({
    mutationFn: async ({
      users,
      action,
      onProgress,
    }: {
      users: LeahUser[];
      action: "mask" | "unmask";
      onProgress?: (done: number, total: number) => void;
    }) => {
      if (isTokenExpired()) {
        console.warn("API Request: Token expired or missing. Connect via settings.");
      }
      if (!clients) throw new Error("Not connected");
      try {
        return await bulkToggleMask(clients.oldProd, tenant, users, action, username, onProgress);
      } catch (err: any) {
        if (err.response?.status === 401) {
          throw new LeahAuthError("Session expired or unauthorized. Please re-connect via settings.");
        }
        throw err;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.users(tenant, 1) });
    },
  });
}
