import { create } from "zustand";
import { persist } from "zustand/middleware";
interface WorkspaceState {
  expert: boolean;
  focused: boolean;
  setExpert(value: boolean): void;
  toggleFocus(): void;
}
/** Préférences d’interface uniquement : aucune scène ou clé dans ce stockage. */
export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set) => ({
      expert: false,
      focused: false,
      setExpert: (expert) => set({ expert }),
      toggleFocus: () => set((s) => ({ focused: !s.focused })),
    }),
    { name: "3dmaker-workspace-v2", partialize: (s) => ({ expert: s.expert }) },
  ),
);
