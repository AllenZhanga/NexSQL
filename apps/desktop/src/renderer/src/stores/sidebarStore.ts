import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SidebarState {
  connectionSearch: string
  collapsedGroups: string[]
  setConnectionSearch: (value: string) => void
  toggleGroup: (group: string) => void
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      connectionSearch: '',
      collapsedGroups: [],
      setConnectionSearch: (connectionSearch) => set({ connectionSearch }),
      toggleGroup: (group) =>
        set((state) => ({
          collapsedGroups: state.collapsedGroups.includes(group)
            ? state.collapsedGroups.filter((item) => item !== group)
            : [...state.collapsedGroups, group]
        }))
    }),
    {
      name: 'nexsql-sidebar-groups',
      partialize: (state) => ({ collapsedGroups: state.collapsedGroups })
    }
  )
)
