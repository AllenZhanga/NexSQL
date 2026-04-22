import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import { useT } from '@renderer/stores/i18nStore'

type DevToolTab = 'json' | 'timestamp' | 'markdown'

export function DevWorkbench(): JSX.Element {
  const t = useT()
  const [tab, setTab] = useState<DevToolTab>('json')

  const [jsonInput, setJsonInput] = useState('')
  const [jsonOutput, setJsonOutput] = useState('')
  const [jsonError, setJsonError] = useState('')

  const [timestampInput, setTimestampInput] = useState('')
  const [timestampToDateOutput, setTimestampToDateOutput] = useState('')
  const [dateInput, setDateInput] = useState('')
  const [dateToTimestampOutput, setDateToTimestampOutput] = useState('')
  const [timeError, setTimeError] = useState('')

  const [markdownInput, setMarkdownInput] = useState('')

  const jsonValid = useMemo(() => {
    if (!jsonInput.trim()) return false
    try {
      JSON.parse(jsonInput)
      return true
    } catch {
      return false
    }
  }, [jsonInput])

  const handleJsonFormat = (): void => {
    if (!jsonInput.trim()) return
    try {
      const parsed = JSON.parse(jsonInput)
      const nextOutput = JSON.stringify(parsed, null, 2)
      setJsonOutput(nextOutput)
      setJsonError('')
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleJsonMinify = (): void => {
    if (!jsonInput.trim()) return
    try {
      const parsed = JSON.parse(jsonInput)
      const nextOutput = JSON.stringify(parsed)
      setJsonOutput(nextOutput)
      setJsonError('')
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleJsonUnescape = (): void => {
    if (!jsonInput.trim()) return
    const next = unescapeEscapedText(jsonInput)
    setJsonInput(next)
    setJsonOutput(next)
    setJsonError('')
  }

  const handleTimestampToDate = (): void => {
    const millis = parseTimestampToMillis(timestampInput)
    if (millis === null) {
      setTimeError(t('devtools.timestamp.invalidTimestamp'))
      setTimestampToDateOutput('')
      return
    }

    const date = new Date(millis)
    if (Number.isNaN(date.getTime())) {
      setTimeError(t('devtools.timestamp.invalidTimestamp'))
      setTimestampToDateOutput('')
      return
    }

    setTimeError('')
    setTimestampToDateOutput(`${date.toLocaleString()}\n${date.toISOString()}`)
  }

  const handleDateToTimestamp = (): void => {
    const raw = dateInput.trim()
    if (!raw) {
      setTimeError(t('devtools.timestamp.invalidDate'))
      setDateToTimestampOutput('')
      return
    }

    const millis = Date.parse(raw)
    if (Number.isNaN(millis)) {
      setTimeError(t('devtools.timestamp.invalidDate'))
      setDateToTimestampOutput('')
      return
    }

    setTimeError('')
    setDateToTimestampOutput(`${Math.floor(millis / 1000)}\n${millis}`)
  }

  const handleFillNow = (): void => {
    const now = Date.now()
    setTimestampInput(String(now))
    setDateInput(new Date(now).toISOString())
    setTimeError('')
  }

  const handleMarkdownUnescape = (): void => {
    if (!markdownInput.trim()) return
    setMarkdownInput(unescapeEscapedText(markdownInput))
  }

  const handleCopy = async (value: string): Promise<void> => {
    if (!value.trim()) return
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Ignore clipboard failures silently to keep the panel lightweight.
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="shrink-0 rounded border border-app-border bg-app-panel p-3">
        <div className="text-xs font-semibold text-text-primary">{t('devtools.title')}</div>
        <div className="mt-1 text-2xs text-text-muted">{t('devtools.subtitle')}</div>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-app-border pb-2">
        <SubTabButton label={t('devtools.tab.json')} active={tab === 'json'} onClick={() => setTab('json')} />
        <SubTabButton label={t('devtools.tab.timestamp')} active={tab === 'timestamp'} onClick={() => setTab('timestamp')} />
        <SubTabButton label={t('devtools.tab.markdown')} active={tab === 'markdown'} onClick={() => setTab('markdown')} />
      </div>

      {tab === 'json' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-2">
            <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
              <div className="text-xs text-text-secondary">{t('devtools.input')}</div>
              <textarea
                value={jsonInput}
                onChange={(event) => setJsonInput(event.target.value)}
                placeholder={t('devtools.json.placeholder')}
                rows={14}
                className="min-h-0 flex-1 resize-none overflow-auto rounded border border-app-border bg-app-input px-2 py-2 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
              />
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button onClick={handleJsonFormat} className="rounded bg-accent-blue px-2.5 py-1 text-xs text-white hover:bg-blue-600">
                  {t('devtools.json.format')}
                </button>
                <button onClick={handleJsonMinify} className="rounded border border-app-border px-2.5 py-1 text-xs text-text-secondary hover:border-accent-blue hover:text-text-primary">
                  {t('devtools.json.minify')}
                </button>
                <button onClick={handleJsonUnescape} className="rounded border border-app-border px-2.5 py-1 text-xs text-text-secondary hover:border-accent-blue hover:text-text-primary">
                  {t('devtools.unescape')}
                </button>
                <button
                  onClick={() => {
                    setJsonInput('')
                    setJsonOutput('')
                    setJsonError('')
                  }}
                  className="rounded border border-app-border px-2.5 py-1 text-xs text-text-secondary hover:border-accent-blue hover:text-text-primary"
                >
                  {t('devtools.clear')}
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
              <div className="flex shrink-0 items-center justify-between">
                <div className="text-xs text-text-secondary">{t('devtools.output')}</div>
                <button
                  onClick={() => void handleCopy(jsonOutput)}
                  className="text-2xs text-text-muted hover:text-text-primary"
                >
                  {t('devtools.copy')}
                </button>
              </div>
              <textarea
                value={jsonOutput}
                readOnly
                rows={14}
                className="min-h-0 flex-1 resize-none overflow-auto rounded border border-app-border bg-app-panel px-2 py-2 text-xs text-text-primary focus:outline-none"
              />
              <div className={clsx('shrink-0 text-2xs', jsonValid ? 'text-accent-green' : 'text-text-muted')}>
                {jsonInput.trim() ? (jsonValid ? t('devtools.json.valid') : t('devtools.json.invalid')) : t('devtools.hint')}
              </div>
            </div>
          </div>
          {jsonError && <div className="shrink-0 rounded border border-accent-red bg-red-500/10 p-2 text-2xs text-accent-red">{jsonError}</div>}
        </div>
      ) : null}

      {tab === 'timestamp' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="flex shrink-0 items-center justify-between rounded border border-app-border bg-app-panel px-3 py-2">
            <div className="text-xs text-text-secondary">{t('devtools.timestamp.now')}: {Date.now()}</div>
            <button onClick={handleFillNow} className="rounded border border-app-border px-2 py-1 text-2xs text-text-secondary hover:border-accent-blue hover:text-text-primary">
              {t('devtools.timestamp.useNow')}
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-2">
            <div className="flex min-h-0 flex-col rounded border border-app-border bg-app-panel p-3">
              <div className="text-xs text-text-secondary">{t('devtools.timestamp.toDate')}</div>
              <textarea
                value={timestampInput}
                onChange={(event) => setTimestampInput(event.target.value)}
                placeholder={t('devtools.timestamp.timestampPlaceholder')}
                rows={4}
                className="mt-2 shrink-0 rounded border border-app-border bg-app-input px-2 py-2 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
              />
              <div className="mt-2 flex shrink-0 items-center gap-2">
                <button onClick={handleTimestampToDate} className="rounded bg-accent-blue px-2.5 py-1 text-xs text-white hover:bg-blue-600">
                  {t('devtools.convert')}
                </button>
                <button onClick={() => void handleCopy(timestampToDateOutput)} className="rounded border border-app-border px-2.5 py-1 text-xs text-text-secondary hover:border-accent-blue hover:text-text-primary">
                  {t('devtools.copy')}
                </button>
              </div>
              <pre className="mt-2 min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded border border-app-border bg-app-bg p-2 text-2xs text-text-secondary">{timestampToDateOutput || '-'}</pre>
            </div>

            <div className="flex min-h-0 flex-col rounded border border-app-border bg-app-panel p-3">
              <div className="text-xs text-text-secondary">{t('devtools.timestamp.toTimestamp')}</div>
              <textarea
                value={dateInput}
                onChange={(event) => setDateInput(event.target.value)}
                placeholder={t('devtools.timestamp.datePlaceholder')}
                rows={4}
                className="mt-2 shrink-0 rounded border border-app-border bg-app-input px-2 py-2 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
              />
              <div className="mt-2 flex shrink-0 items-center gap-2">
                <button onClick={handleDateToTimestamp} className="rounded bg-accent-blue px-2.5 py-1 text-xs text-white hover:bg-blue-600">
                  {t('devtools.convert')}
                </button>
                <button onClick={() => void handleCopy(dateToTimestampOutput)} className="rounded border border-app-border px-2.5 py-1 text-xs text-text-secondary hover:border-accent-blue hover:text-text-primary">
                  {t('devtools.copy')}
                </button>
              </div>
              <pre className="mt-2 min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded border border-app-border bg-app-bg p-2 text-2xs text-text-secondary">{dateToTimestampOutput || '-'}</pre>
            </div>
          </div>

          {timeError && <div className="shrink-0 rounded border border-accent-red bg-red-500/10 p-2 text-2xs text-accent-red">{timeError}</div>}
        </div>
      ) : null}

      {tab === 'markdown' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-3 overflow-hidden lg:grid-cols-2 lg:grid-rows-1">
            <div className="min-w-0 overflow-hidden lg:flex lg:min-h-0 lg:flex-col">
              <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
              <div className="text-xs text-text-secondary">{t('devtools.markdown.editor')}</div>
              <textarea
                value={markdownInput}
                onChange={(event) => setMarkdownInput(event.target.value)}
                placeholder={t('devtools.markdown.placeholder')}
                rows={18}
                className="min-h-0 flex-1 resize-none overflow-auto rounded border border-app-border bg-app-input px-2 py-2 font-mono text-xs text-text-primary focus:border-accent-blue focus:outline-none"
              />
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={handleMarkdownUnescape} className="rounded border border-app-border px-2.5 py-1 text-xs text-text-secondary hover:border-accent-blue hover:text-text-primary">
                  {t('devtools.unescape')}
                </button>
                <button onClick={() => setMarkdownInput('')} className="rounded border border-app-border px-2.5 py-1 text-xs text-text-secondary hover:border-accent-blue hover:text-text-primary">
                  {t('devtools.clear')}
                </button>
                <button onClick={() => void handleCopy(markdownInput)} className="rounded bg-accent-blue px-2.5 py-1 text-xs text-white hover:bg-blue-600">
                  {t('devtools.copy')}
                </button>
              </div>
              </div>
            </div>

            <div className="min-w-0 overflow-hidden lg:flex lg:min-h-0 lg:flex-col">
              <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <div className="text-xs text-text-secondary">{t('devtools.markdown.preview')}</div>
                  <button
                    onClick={() => void handleCopy(markdownInput)}
                    className="rounded border border-app-border px-2 py-1 text-2xs text-text-secondary hover:border-accent-blue hover:text-text-primary"
                  >
                    {t('devtools.markdown.copyPreview')}
                  </button>
                </div>
                <div className="min-h-0 flex-1 max-w-full overflow-auto rounded border border-app-border bg-app-panel p-3 text-sm text-text-primary">
                {markdownInput.trim() ? (
                  <div className="max-w-none break-words leading-6 [overflow-wrap:anywhere] [&_code]:break-all [&_li]:break-words [&_p]:break-words [&_pre]:max-w-full [&_pre]:overflow-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-auto [&_td]:break-words [&_th]:break-words">
                    <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{markdownInput}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="text-2xs text-text-muted">{t('devtools.markdown.empty')}</div>
                )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SubTabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded px-2 py-1 text-xs transition-colors',
        active ? 'bg-app-active text-white' : 'text-text-secondary hover:bg-app-hover hover:text-text-primary'
      )}
    >
      {label}
    </button>
  )
}

function parseTimestampToMillis(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed || !/^[-]?\d+$/.test(trimmed)) return null
  const numeric = Number(trimmed)
  if (!Number.isFinite(numeric)) return null
  return Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric
}

function unescapeEscapedText(value: string): string {
  return value.replace(/\\(u[\da-fA-F]{4}|x[\da-fA-F]{2}|n|r|t|b|f|v|0|\\|"|')/g, (full, token) => {
    if (token === 'n') return '\n'
    if (token === 'r') return '\r'
    if (token === 't') return '\t'
    if (token === 'b') return '\b'
    if (token === 'f') return '\f'
    if (token === 'v') return '\v'
    if (token === '0') return '\0'
    if (token === '\\') return '\\'
    if (token === '"') return '"'
    if (token === "'") return "'"
    if (token.startsWith('u')) return String.fromCharCode(parseInt(token.slice(1), 16))
    if (token.startsWith('x')) return String.fromCharCode(parseInt(token.slice(1), 16))
    return full
  })
}