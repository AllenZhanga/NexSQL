import { useId, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { SSHConfig } from '@shared/types/connection'
import { sshAuthMethod } from '@shared/ssh'
import { useT } from '@renderer/stores/i18nStore'

export function SSHConnectionFields({
  enabled,
  onEnabledChange,
  value,
  onChange
}: {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  value: SSHConfig
  onChange: (value: SSHConfig) => void
}): JSX.Element {
  const t = useT()
  const [expanded, setExpanded] = useState(enabled)
  const id = useId()
  const input =
    'w-full bg-app-input border border-app-border rounded px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue selectable'
  const method = sshAuthMethod(value)
  const field = (name: keyof SSHConfig, label: string, type: string, placeholder = '') => (
    <label className="block space-y-1 text-xs text-text-secondary" htmlFor={`${id}-${name}`}>
      <span>{label}</span>
      <input
        id={`${id}-${name}`}
        type={type}
        value={String(value[name] ?? '')}
        onChange={(event) =>
          onChange({
            ...value,
            [name]: name === 'port' ? Number(event.target.value) : event.target.value
          })
        }
        placeholder={placeholder}
        className={input}
        autoComplete={type === 'password' ? 'new-password' : 'off'}
      />
    </label>
  )
  return (
    <section className="border border-app-border rounded">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:text-text-primary"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-medium">{t('conn.sshTunnel')}</span>
        {enabled && (
          <span className="ml-auto text-emerald-500 text-2xs">{t('conn.sshEnabled')}</span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-app-border">
          <label className="flex items-center gap-2 pt-3 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => onEnabledChange(event.target.checked)}
            />
            {t('conn.sshEnable')}
          </label>
          {enabled && (
            <>
              <p className="text-xs leading-5 text-text-muted">{t('conn.sshHint')}</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  {field('host', t('conn.sshHost'), 'text', 'bastion.example.com')}
                </div>
                {field('port', t('conn.sshPort'), 'number')}
              </div>
              {field('username', t('conn.sshUser'), 'text', 'ubuntu')}
              <label className="block space-y-1 text-xs text-text-secondary" htmlFor={`${id}-auth`}>
                <span>{t('conn.sshAuth')}</span>
                <select
                  id={`${id}-auth`}
                  value={method}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      authMethod: event.target.value as 'password' | 'privateKey'
                    })
                  }
                  className={input}
                >
                  <option value="password">{t('conn.sshAuthPassword')}</option>
                  <option value="privateKey">{t('conn.sshAuthKey')}</option>
                </select>
              </label>
              {method === 'password' ? (
                field(
                  'password',
                  t('conn.sshPassword'),
                  'password',
                  value.hasPassword ? t('conn.sshSavedPassword') : t('conn.sshPassword')
                )
              ) : (
                <>
                  {field('privateKeyPath', t('conn.sshKeyPath'), 'text', '~/.ssh/id_ed25519')}
                  {field(
                    'passphrase',
                    t('conn.sshPassphrase'),
                    'password',
                    value.hasPassphrase
                      ? t('conn.sshSavedPassphrase')
                      : t('conn.sshEmptyPassphrase')
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
