import { useState } from 'react'
import { Sparkles, ChevronDown, Settings, Loader2, ArrowUpRight } from 'lucide-react'
import { useAIStore } from '@renderer/stores/aiStore'
import { useQueryStore } from '@renderer/stores/queryStore'
import { useUIStore } from '@renderer/stores/uiStore'

export function AIInputBar(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [error, setError] = useState('')
  const { generateSQL, isGenerating, loadConfig } = useAIStore()
  const { tabs, activeTabId, newTab, updateTabSQL, updateTabDatabase } = useQueryStore()
  const tab = tabs.find((t) => t.id === activeTabId)
  const generate = async (): Promise<void> => {
    if (!question.trim() || !tab?.connectionId || isGenerating) return
    const connectionId = tab.connectionId,
      database = tab.selectedDatabase
    setError('')
    try {
      await loadConfig()
      const sql = await generateSQL(question.trim(), connectionId, database ?? undefined)
      const id = newTab(connectionId)
      updateTabDatabase(id, database)
      updateTabSQL(id, sql)
      setQuestion('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  return (
    <section className="sql-assistant">
      <button className="assistant-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Sparkles size={13} />
        <span>自然语言生成 SQL</span>
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open && (
        <div className="assistant-body">
          <div className="flex gap-2">
            <input
              aria-label="查询需求"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void generate()
              }}
              placeholder="例如：查询最近 30 天每天的订单数"
              className="flex-1 min-w-0 rounded-lg bg-app-input border border-app-border px-3 py-2 text-sm selectable"
            />
            <button
              className="primary-button"
              disabled={!question.trim() || !tab?.connectionId || isGenerating}
              onClick={() => void generate()}
            >
              {isGenerating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ArrowUpRight size={14} />
              )}
              生成
            </button>
            <button
              aria-label="配置 SQL 生成模型"
              onClick={() => useUIStore.getState().setShowSettings(true)}
              className="px-2 text-text-secondary"
            >
              <Settings size={15} />
            </button>
          </div>
          <p className="mt-2 text-xs text-text-muted">
            向已配置的模型发送当前数据库结构和你的问题。生成结果在新标签中打开，由你审查后执行。
          </p>
          {error && (
            <p role="alert" className="mt-2 text-xs text-accent-red">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
