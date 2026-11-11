import {useLayoutEffect} from 'react'
import {Trans, useLingui} from '@lingui/react/macro'

import {useLoggedOutViewControls} from '#/state/shell/logged-out'
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

export function StartupSignIn({
  accountDid,
  onCancel,
}: {
  accountDid: string
  onCancel: () => void
}) {
  const {t: l} = useLingui()
  const {requestSwitchToAccount, setShowLoggedOut, clearRequestedAccount} =
    useLoggedOutViewControls()
  useLayoutEffect(() => {
    requestSwitchToAccount({requestedAccount: accountDid})
  }, [accountDid, requestSwitchToAccount])
  return (
    <div style={{position: 'fixed', top: 12, right: 12, zIndex: 1000}}>
      <Button
        label={l`Cancel sign-in`}
        size="small"
        color="secondary"
        onPress={() => {
          setShowLoggedOut(false)
          clearRequestedAccount()
          onCancel()
        }}>
        <ButtonText>
          <Trans>Cancel sign-in</Trans>
        </ButtonText>
      </Button>
    </div>
  )
}

export function StartupRecovery({
  onRetry,
  accountDid,
  onSignIn,
}: {
  onRetry: () => void
  accountDid?: string
  onSignIn: () => void
}) {
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
        {accountDid ? (
          <Trans>Please sign in again.</Trans>
        ) : (
          <Trans>Startup is taking longer than expected.</Trans>
        )}
      </Text>
      <Text style={[a.text_center]}>
        {accountDid ? (
          <Trans>
            Your session is no longer valid. Your saved account and reading
            place have not been cleared.
          </Trans>
        ) : (
          <Trans>
            Check your connection and try again. Your saved account and reading
            place have not been cleared.
          </Trans>
        )}
      </Text>
      <Button
        label={accountDid ? l`Sign in again` : l`Retry`}
        size="large"
        color="primary"
        onPress={() => {
          if (accountDid) {
            onSignIn()
          } else {
            onRetry()
          }
        }}>
        <ButtonText>
          {accountDid ? <Trans>Sign in again</Trans> : <Trans>Retry</Trans>}
        </ButtonText>
      </Button>
    </div>
  )
}
