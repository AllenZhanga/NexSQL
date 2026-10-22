import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Upload, CheckCircle2 } from 'lucide-react'
import { CONNECTION_IMPORT_MAX_BYTES } from '@shared/types/connectionImport'
import type { ConnectionImportPreview } from '@shared/types/connectionImport'

const statusLabels = {
  ready: '可导入',
  duplicate: '已存在',
  unsupported: '暂不支持',
  invalid: '配置无效'
}
const passwordLabels = {
  included: '可迁移',
  missing: '未包含',
  unavailable: '需重填',
  'not-needed': '无需密码'
}
const importErrorMessage = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(
    /^Error invoking remote method '[^']+': Error:\s*/,
    ''
  )

export function ConnectionImportDialog({
  onClose,
  onImported
}: {
  onClose: () => void
  onImported: () => Promise<void>
}): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const working = useRef(false)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [content, setContent] = useState('')
  const [preview, setPreview] = useState<ConnectionImportPreview | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<number | null>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const readFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || working.current || !window.db) return
    working.current = true
    setBusy(true)
    setError('')
    setSaved(null)
    setPreview(null)
    setContent('')
    setSelected(new Set())
    setFileName(file.name)
    try {
      if (file.size > CONNECTION_IMPORT_MAX_BYTES) throw new Error('连接文件不能超过 5 MB')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const encoding =
        bytes[0] === 0xff && bytes[1] === 0xfe
          ? 'utf-16le'
          : bytes[0] === 0xfe && bytes[1] === 0xff
            ? 'utf-16be'
            : 'utf-8'
      const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
      const result = await window.db.previewConnectionImport(text)
      setContent(text)
      setPreview(result)
      setSelected(
        new Set(
          result.entries.filter((entry) => entry.status === 'ready').map((entry) => entry.index)
        )
      )
    } catch (err) {
      setError(importErrorMessage(err))
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    if (working.current || !window.db || !preview || !selected.size || saved !== null) return
    working.current = true
    setBusy(true)
    setError('')
    try {
      const count = await window.db.importConnections(content, [...selected])
      setSaved(count)
      setContent('')
      await onImported()
    } catch (err) {
      setError(importErrorMessage(err))
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  const ready = preview?.entries.filter((entry) => entry.status === 'ready') ?? []
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby="connection-import-title"
      className="m-auto w-[900px] max-w-[calc(100vw-40px)] max-h-[85vh] p-0 rounded-xl border border-app-border bg-app-sidebar text-text-primary shadow-2xl backdrop:bg-black/40"
      onCancel={(event) => {
        event.preventDefault()
        if (!working.current) onClose()
      }}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-app-border">
        <div>
          <h2 id="connection-import-title" className="font-semibold text-sm">
            导入连接
          </h2>
          <p className="text-xs text-text-muted mt-1">从 Navicat 或 NexSQL 迁移连接配置</p>
        </div>
        <button
          aria-label="关闭导入连接"
          disabled={busy}
          onClick={onClose}
          className="p-1 rounded hover:bg-app-hover disabled:opacity-40"
        >
          <X size={16} />
        </button>
      </div>
      <div className="px-5 py-4 space-y-4 overflow-auto max-h-[calc(85vh-155px)]">
        <div className="rounded-lg border border-dashed border-app-border bg-app-bg p-4 space-y-2">
          <label className="block text-xs font-medium" htmlFor="connection-import-file">
            选择连接文件
          </label>
          <input
            id="connection-import-file"
            type="file"
            accept=".ncx,.xml,.json"
            disabled={busy}
            onChange={readFile}
            className="block w-full text-xs text-text-secondary file:mr-3 file:rounded file:border file:border-app-border file:bg-app-hover file:px-3 file:py-1.5 file:text-text-primary"
          />
          <p className="text-xs text-text-muted leading-5">
            Navicat：文件 → 导出连接，保存为 .ncx；也支持 NexSQL .json。单个文件最大 5 MB。
          </p>
          <p className="text-xs text-text-muted">
            预览不建立数据库连接。只新增勾选的连接，已存在的相同配置自动跳过。
          </p>
        </div>
        {error && (
          <p role="alert" className="text-xs text-accent-red break-words">
            {error}
          </p>
        )}
        {saved !== null && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-accent-green/30 bg-accent-green/10 p-3 text-xs text-accent-green"
          >
            <CheckCircle2 size={15} />
            已导入 {saved} 个连接。需要补填密码的连接，可在连接列表右键编辑。
          </div>
        )}
        {preview && (
          <>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-text-secondary" title={fileName}>
                {fileName} · {preview.format === 'navicat' ? 'Navicat' : 'NexSQL'} ·{' '}
                {preview.entries.length} 个连接
              </span>
              <span className="shrink-0 text-text-muted">
                可导入 {ready.length} · 跳过 {preview.entries.length - ready.length}
              </span>
            </div>
            <div className="overflow-auto max-h-[38vh] rounded-lg border border-app-border">
              <table className="w-full text-xs text-left">
                <thead className="sticky top-0 bg-app-sidebar text-text-muted">
                  <tr>
                    <th className="p-2 w-9">
                      <input
                        type="checkbox"
                        aria-label="选择全部可导入连接"
                        disabled={busy || saved !== null || !ready.length}
                        checked={!!ready.length && selected.size === ready.length}
                        onChange={(event) =>
                          setSelected(
                            new Set(event.target.checked ? ready.map((entry) => entry.index) : [])
                          )
                        }
                      />
                    </th>
                    <th className="p-2 font-medium">连接 / 地址</th>
                    <th className="p-2 font-medium">数据库 / 用户</th>
                    <th className="p-2 font-medium">密码</th>
                    <th className="p-2 font-medium min-w-[160px]">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.entries.map((entry) => (
                    <tr
                      key={entry.index}
                      className="border-t border-app-border align-top hover:bg-app-hover"
                    >
                      <td className="p-2">
                        <input
                          type="checkbox"
                          aria-label={`导入 ${entry.name || `连接 ${entry.index + 1}`}`}
                          disabled={busy || saved !== null || entry.status !== 'ready'}
                          checked={selected.has(entry.index)}
                          onChange={(event) =>
                            setSelected((previous) => {
                              const next = new Set(previous)
                              if (event.target.checked) next.add(entry.index)
                              else next.delete(entry.index)
                              return next
                            })
                          }
                        />
                      </td>
                      <td className="p-2">
                        <p className="font-medium break-all">{entry.name || '未命名连接'}</p>
                        {entry.ssh && (
                          <p className="text-text-muted mt-1 break-all">
                            SSH · {entry.ssh.username}@{entry.ssh.host}:{entry.ssh.port} ·{' '}
                            {entry.ssh.authMethod === 'privateKey' ? '私钥' : '密码'}
                            {entry.ssh.credentialStatus === 'included'
                              ? '（凭据可迁移）'
                              : entry.ssh.credentialStatus === 'unavailable'
                                ? '（凭据需重填）'
                                : ''}
                          </p>
                        )}
                        <p className="text-text-muted mt-1 break-all">
                          {entry.sourceType} · {entry.address || '—'}
                        </p>
                        {entry.group && <p className="text-text-muted mt-1">分组：{entry.group}</p>}
                      </td>
                      <td className="p-2 break-all">
                        <p>{entry.database || '默认数据库'}</p>
                        <p className="text-text-muted mt-1">{entry.username || '—'}</p>
                      </td>
                      <td className="p-2 whitespace-nowrap text-text-secondary">
                        {passwordLabels[entry.passwordStatus]}
                      </td>
                      <td className="p-2">
                        <p
                          className={
                            entry.status === 'ready' ? 'text-accent-green' : 'text-text-muted'
                          }
                        >
                          {statusLabels[entry.status]}
                        </p>
                        {entry.warnings.map((warning, index) => (
                          <p key={index} className="text-text-muted leading-5 mt-1">
                            {warning}
                          </p>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-text-muted leading-5">
              兼容的数据库和 SSH
              密码会在本机转换后保存，预览不显示密码内容。无法转换的密码需要重填；HTTP
              隧道、客户端证书等不兼容配置会标记并跳过。
            </p>
          </>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-app-border text-xs">
        <span className="text-text-muted">
          {busy ? '正在处理…' : saved !== null ? '导入完成' : `已选择 ${selected.size} 个连接`}
        </span>
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={onClose}
            className="px-3 py-1.5 border border-app-border rounded hover:bg-app-hover disabled:opacity-40"
          >
            {saved !== null ? '完成' : '取消'}
          </button>
          {saved === null && (
            <button
              disabled={busy || !selected.size}
              onClick={() => void save()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-blue text-white rounded disabled:opacity-40"
            >
              <Upload size={13} />
              导入所选（{selected.size}）
            </button>
          )}
        </div>
      </div>
    </dialog>,
    document.body
  )
}
