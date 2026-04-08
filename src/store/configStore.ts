import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ConfigState {
  selectedAppTypeId: number | null;
  setSelectedAppTypeId: (id: number | null) => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      selectedAppTypeId: null,
      setSelectedAppTypeId: (id) => set({ selectedAppTypeId: id }),
    }),
    { name: "leah-config" }
  )
);
