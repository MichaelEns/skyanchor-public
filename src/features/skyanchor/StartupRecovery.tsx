import {Trans, useLingui} from '@lingui/react/macro'

import {atoms as a, useTheme} from '#/alf'
import {Button, ButtonText} from '#/components/Button'
import {Text} from '#/components/Typography'
import {useGeolocation} from '#/geolocation'
import {resolve} from '#/geolocation/service'

export function startupPhase(
  phase: 'storage' | 'session' | 'blocked' | 'retry' | 'ready',
) {
  document.documentElement.dataset.skyanchorStartupPhase = phase
  window.dispatchEvent(new CustomEvent('skyanchor-startup', {detail: phase}))
}

export function StartupConfigStatus() {
  const geolocation = useGeolocation()
  const t = useTheme()
  const {t: l} = useLingui()
  if (geolocation.countryCode) return null
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: 12,
        left: 12,
        right: 12,
        zIndex: 100,
        padding: 12,
        background: t.atoms.bg.backgroundColor,
      }}>
      <Text>
        <Trans>
          Regional configuration is unavailable. Content restrictions remain in
          effect. Check your connection and retry.
        </Trans>
      </Text>
      <Button
        label={l`Retry regional configuration`}
        size="small"
        color="secondary"
        onPress={() => void resolve()}>
        <ButtonText>
          <Trans>Retry regional configuration</Trans>
        </ButtonText>
      </Button>
    </div>
  )
}

export function StartupRecovery({onRetry}: {onRetry: () => void}) {
  const t = useTheme()
  const {t: l} = useLingui()
  return (
    <div
      role="alert"
      data-testid="startup-recovery"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: 24,
        background: t.atoms.bg.backgroundColor,
      }}>
      <Text style={[a.text_lg, a.text_center]}>
        <Trans>Startup is taking longer than expected.</Trans>
      </Text>
      <Text style={[a.text_center]}>
        <Trans>
          Check your connection and try again. Your saved account and reading
          place have not been cleared.
        </Trans>
      </Text>
      <Button label={l`Retry`} size="large" color="primary" onPress={onRetry}>
        <ButtonText>
          <Trans>Retry</Trans>
        </ButtonText>
      </Button>
    </div>
  )
}
