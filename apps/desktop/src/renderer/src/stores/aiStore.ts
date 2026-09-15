import { create } from 'zustand'
import type { AIConfig } from '@shared/types/ai'
interface AIState {
  config: AIConfig | null
  isGenerating: boolean
  loadConfig(): Promise<void>
  updateConfig(config: Partial<AIConfig>): Promise<void>
  generateSQL(question: string, connectionId: string, database?: string): Promise<string>
}
export const useAIStore = create<AIState>((set, get) => ({
  config: null,
  isGenerating: false,
  loadConfig: async () => {
    if (window.ai) set({ config: await window.ai.getConfig() })
  },
  updateConfig: async (config) => {
    if (!window.ai) throw new Error('AI 接口不可用')
    await window.ai.updateConfig(config)
    await get().loadConfig()
  },
  generateSQL: async (question, connectionId, database) => {
    if (!window.ai) throw new Error('AI 接口不可用')
    if (get().isGenerating) throw new Error('正在生成 SQL，请稍候')
    set({ isGenerating: true })
    try {
      return await window.ai.generateSQL({
        question,
        connectionId,
        databaseName: database,
        dialect: 'sql'
      })
    } finally {
      set({ isGenerating: false })
    }
  }
}))
