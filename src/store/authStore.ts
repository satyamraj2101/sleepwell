import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface ConnectionConfig {
  cloudInstance: string;  // e.g. "cloud20.contractpod.com"
  newCloudApi: string;    // e.g. "cpai-productapi-pus20.azurewebsites.net"
  tenant: string;         // e.g. "pentair"
  username: string;
}

interface AuthState extends ConnectionConfig {
  token: string | null;
  tokenExpiresAt: number | null; // unix timestamp ms
  isConnected: boolean;

  // Actions
  setToken: (token: string, expiresIn: number) => void;
  setConfig: (cfg: Partial<ConnectionConfig>) => void;
  logout: () => void;
  isTokenExpired: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Defaults — safe staging values
      cloudInstance: "cloudstaging5.contractpod.com",
      newCloudApi: "cpai-productapi-stg5.azurewebsites.net",
      tenant: "integreonpg",
      username: "",
      token: null,
      tokenExpiresAt: null,
      isConnected: false,

      setToken: (token, expiresIn) =>
        set({
          token,
          tokenExpiresAt: Date.now() + expiresIn * 1000,
          isConnected: true,
        }),

      setConfig: (cfg) => set((state) => ({ ...state, ...cfg })),

      logout: () =>
        set({
          token: null,
          tokenExpiresAt: null,
          isConnected: false,
        }),

      isTokenExpired: () => {
        const { tokenExpiresAt } = get();
        if (!tokenExpiresAt) return true;
        return Date.now() > tokenExpiresAt - 60_000; // 1 min buffer
      },
    }),
    {
      name: "leah-auth",
      storage: createJSONStorage(() => localStorage),
      // Never persist the token itself — re-auth on page refresh
      partialize: (state) => ({
        cloudInstance: state.cloudInstance,
        newCloudApi: state.newCloudApi,
        tenant: state.tenant,
        username: state.username,
        token: state.token,
        tokenExpiresAt: state.tokenExpiresAt,
        isConnected: state.isConnected,
      }),
    }
  )
);

// Convenience selector hooks
export const useToken = () => useAuthStore((s) => s.token);
export const useTenant = () => useAuthStore((s) => s.tenant);
export const useConfig = () =>
  useAuthStore((s) => ({
    cloudInstance: s.cloudInstance,
    newCloudApi: s.newCloudApi,
    tenant: s.tenant,
    username: s.username,
  }));
export const useIsConnected = () => useAuthStore((s) => s.isConnected);
