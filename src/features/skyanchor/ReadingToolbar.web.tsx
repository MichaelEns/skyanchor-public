import {useEffect, useRef, useState} from 'react'
import {View} from 'react-native'
import {Trans, useLingui} from '@lingui/react/macro'
import {createPortal} from 'react-dom'

import {logger} from '#/logger'
import {type SessionAccount, useSession, useSessionApi} from '#/state/session'
import {atoms as a, useTheme} from '#/alf'
import {Button, ButtonIcon, ButtonText} from '#/components/Button'
import * as Dialog from '#/components/Dialog'
import {Bookmark_Stroke2_Corner0_Rounded as ReadingIcon} from '#/components/icons/Bookmark'
import {Text} from '#/components/Typography'
import {
  authenticateSyncAccount,
  SyncAuthenticationError,
  syncAuthService,
} from './auth-service'
import {
  type ReadingFeed,
  type ReadingPlace,
  readingStorageKey,
  type SyncPlace,
  validSyncPlace,
} from './domain'
import {
  getSyncSession,
  refreshSyncAccount,
  setSyncSession,
  syncSessionRequest,
} from './sync'

type Remote = SyncPlace
export function ReadingToolbar({
  enabled,
  feed = 'following',
  account,
  notice,
  hasNew,
  canReturn,
  loading,
  onRefresh,
  onLatest,
  onReturn,
  capture,
  resume,
}: {
  enabled: boolean
  feed?: ReadingFeed
  account: SessionAccount
  notice: string
  hasNew: boolean
  canReturn: boolean
  loading: string
  onRefresh: () => Promise<void>
  onLatest: () => Promise<void>
  onReturn: () => Promise<void>
  capture: () => ReadingPlace | undefined
  resume: (place: ReadingPlace | undefined) => Promise<void>
}) {
  const {t: l} = useLingui()
  const t = useTheme()
  const {currentAccount} = useSession()
  const {refreshSession} = useSessionApi()
  const liveAccount = useRef(currentAccount)
  liveAccount.current = currentAccount
  const control = Dialog.useDialogControl()
  const [slot, setSlot] = useState<HTMLElement | undefined>()
  const [expanded, setExpanded] = useState(false)
  const [attention, setAttention] = useState(false)
  const [unsaved, setUnsaved] = useState(false)
  const [csrf, setCsrf] = useState('')
  const [status, setStatus] = useState('')
  const [other, setOther] = useState<Remote | undefined>()
  const [busy, setBusy] = useState(false)
  const revision = useRef(
    Number(
      localStorage.getItem(
        readingStorageKey('skyanchor:revision:', account.did, feed),
      ) || 0,
    ),
  )
  const automatic = useRef(false)
  const writing = useRef(false)
  const lastSaved = useRef('')
  const lastCaptured = useRef('')
  const pending = useRef(false)
  const observedRevision = useRef(0)
  const generation = useRef(0)
  const session = useRef({csrf: '', expires: 0})
  const renewing = useRef<Promise<void> | undefined>(undefined)
  const activeRuns = useRef(0)
  const [deviceId] = useState(() => {
    const stored = localStorage.getItem('skyanchor:device')
    if (stored) return stored
    const id = crypto.randomUUID()
    localStorage.setItem('skyanchor:device', id)
    return id
  })
  const device = useRef(deviceId)

  function acceptRevision(value: number) {
    revision.current = value
    localStorage.setItem(
      readingStorageKey('skyanchor:revision:', account.did, feed),
      String(value),
    )
  }
  async function request(
    path: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<Remote> {
    const started = generation.current
    const shared = getSyncSession(account.did)
    if (shared && shared.expires > session.current.expires)
      session.current = shared
    if (session.current.expires <= Date.now() && retry) await renew()
    if (
      started !== generation.current ||
      !live.current.enabled ||
      liveAccount.current?.did !== account.did
    )
      throw new Error(l`Account changed; sync response discarded.`)
    const response = await fetch(
      '/api/skyanchor/' +
        path +
        (path === 'place' && feed !== 'following'
          ? '?feed=' + encodeURIComponent(feed)
          : ''),
      {
        ...init,
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'x-skyanchor-csrf': session.current.csrf,
          ...init.headers,
        },
      },
    )
    const value: unknown = await response.json()
    if (
      started !== generation.current ||
      !live.current.enabled ||
      liveAccount.current?.did !== account.did
    )
      throw new Error(l`Account changed; sync response discarded.`)
    if ((response.status === 401 || response.status === 403) && retry) {
      await renew()
      return request(path, init, false)
    }
    if (response.status === 409) {
      if (
        !value ||
        typeof value !== 'object' ||
        !('current' in value) ||
        !validSyncPlace(value.current, account.did, feed)
      ) {
        throw new Error(l`Invalid private sync conflict response`)
      }
      setOther(value.current)
      observedRevision.current = Math.max(
        observedRevision.current,
        value.current.revision,
      )
      automatic.current = false
      throw new Error(
        l`CAS conflict: your place changed on another device. Choose Resume other device or Keep mine.`,
      )
    }
    if (response.status === 422)
      throw new Error(
        l`Profile reading-place capacity reached (64 filters including deleted-place markers). Existing places were not evicted.`,
      )
    if (!response.ok)
      throw new Error(
        l`Private sync failed (${response.status}). Reconnect if the session expired.`,
      )
    if (!validSyncPlace(value, account.did, feed)) {
      throw new Error(l`Invalid private sync response or account binding`)
    }
    return value
  }
  async function checkRemote() {
    if (!session.current.csrf || !enabled) return
    automatic.current = false
    const current = await request('place')
    if (current.revision < Math.max(revision.current, observedRevision.current))
      throw new Error(l`Stale sync completion discarded.`)
    observedRevision.current = Math.max(
      observedRevision.current,
      current.revision,
    )
    if (
      current.revision > revision.current &&
      current.device !== device.current
    ) {
      setOther(current)
      setAttention(false)
      setStatus(
        l`Another device has a saved place. Your viewport has not moved.`,
      )
    } else {
      if (current.revision >= revision.current) acceptRevision(current.revision)
      lastSaved.current = JSON.stringify(current.state)
      setUnsaved(
        !!lastCaptured.current && lastCaptured.current !== lastSaved.current,
      )
      automatic.current = true
      setAttention(false)
      setStatus(
        l`Connected. Last saved place checked; your viewport has not moved.`,
      )
    }
  }
  async function run(action: () => Promise<void>) {
    const started = generation.current
    activeRuns.current++
    setBusy(true)
    try {
      await action()
    } catch (error) {
      if (started !== generation.current) return
      logger.warn('SkyAnchor private sync failed', {message: error})
      setStatus(error instanceof Error ? error.message : l`Private sync failed`)
      setAttention(true)
    } finally {
      if (started === generation.current) {
        activeRuns.current--
        setBusy(activeRuns.current > 0)
      }
    }
  }
  async function connect(reuse = true) {
    const started = generation.current
    const active = () =>
      started === generation.current &&
      liveAccount.current?.did === account.did &&
      live.current.enabled
    const credentials = liveAccount.current
    if (!active() || !credentials)
      throw new Error(l`Account changed; sync response discarded.`)
    if (!syncAuthService(credentials.service)) {
      throw new Error(
        l`Private sync supports Bluesky-operated accounts, including regional hosted servers. This provider is not supported; your place stays saved locally.`,
      )
    }
    if (!navigator.onLine)
      throw new Error(
        l`Offline: private sync cannot connect. Your local reading place and Return are preserved; retry when online.`,
      )
    const shared = getSyncSession(account.did)
    if (reuse && shared && shared.expires > Date.now()) {
      session.current = shared
      setCsrf(shared.csrf)
      setAttention(false)
      return
    }
    let response: Response
    try {
      response = await authenticateSyncAccount({
        account: credentials,
        active,
        refresh: async () => {
          try {
            return await refreshSyncAccount(account.did, refreshSession)
          } catch (error) {
            logger.warn('SkyAnchor account renewal failed', {message: error})
            throw new Error(
              l`Bluesky session renewal did not complete. Check your connection and retry; if sign-in is required, your local place and Return are preserved.`,
            )
          }
        },
        request: fresh =>
          syncSessionRequest(
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${fresh.accessJwt}`,
              },
              body: JSON.stringify({
                device: device.current,
                service: syncAuthService(fresh.service),
              }),
            },
            active,
          ),
      })
    } catch (error) {
      if (!(error instanceof SyncAuthenticationError)) throw error
      if (error.reason === 'account-changed')
        throw new Error(l`Account changed; sync response discarded.`)
      if (error.reason === 'unsupported-service')
        throw new Error(
          l`Private sync cannot verify this provider. Your local reading place is preserved.`,
        )
      throw new Error(
        l`Your Bluesky session needs renewal. Sign in to this account again when ready; your local reading place and Return are preserved.`,
      )
    }
    const value: unknown = await response.json()
    if (!active()) throw new Error(l`Account changed; sync response discarded.`)
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? l`Your Bluesky session needs renewal. Sign in again when ready; local reading progress is preserved.`
          : l`Private sync could not connect (${response.status}). Your place stays local; retry when the connection is available.`,
      )
    if (
      !value ||
      typeof value !== 'object' ||
      !('did' in value) ||
      value.did !== account.did ||
      !('csrf' in value) ||
      typeof value.csrf !== 'string' ||
      !('expiresIn' in value) ||
      typeof value.expiresIn !== 'number' ||
      value.expiresIn <= 0 ||
      value.expiresIn > 600
    )
      throw new Error(l`Private sync account binding mismatch`)
    session.current = {
      csrf: value.csrf,
      expires: Date.now() + (value.expiresIn - 30) * 1000,
    }
    setCsrf(value.csrf)
    localStorage.setItem('skyanchor:sync-enabled:' + account.did, '1')
    setSyncSession(account.did, session.current)
    setAttention(false)
    setStatus(
      l`Private sync connected. Reading progress saves automatically; fetched posts are not marked read.`,
    )
  }
  async function renew(reuse = false) {
    if (!renewing.current) {
      renewing.current = connect(reuse).finally(() => {
        renewing.current = undefined
      })
    }
    await renewing.current
  }
  async function save(expectedRevision = revision.current, keepalive = false) {
    if (writing.current) {
      pending.current = true
      return
    }
    if (!navigator.onLine)
      throw new Error(
        l`Offline: no write sent. Reconnect and resolve any stale revision explicitly.`,
      )
    const place = capture()
    if (!place) throw new Error(l`No visible reading place to save`)
    writing.current = true
    const started = generation.current
    try {
      const current = await request('place', {
        method: 'PUT',
        keepalive,
        body: JSON.stringify({revision: expectedRevision, state: place}),
      })
      if (
        current.revision < Math.max(revision.current, observedRevision.current)
      ) {
        automatic.current = false
        throw new Error(l`Stale sync completion discarded.`)
      }
      acceptRevision(current.revision)
      lastSaved.current = JSON.stringify(place)
      setUnsaved(
        !!lastCaptured.current && lastCaptured.current !== lastSaved.current,
      )
      setAttention(false)
      setOther(undefined)
      automatic.current = true
      setStatus(l`Private reading place saved.`)
    } finally {
      if (started === generation.current) writing.current = false
    }
  }
  const live = useRef({capture, save, run, checkRemote, enabled, csrf})
  live.current = {capture, save, run, checkRemote, enabled, csrf}
  useEffect(() => {
    if (!csrf || !enabled) return
    let timer: ReturnType<typeof setTimeout>
    const flush = (keepalive = false) => {
      if (!automatic.current || !live.current.enabled) return
      const place = live.current.capture()
      if (!place || JSON.stringify(place) === lastSaved.current) return
      void live.current.run(() =>
        live.current.save(revision.current, keepalive),
      )
    }
    const moved = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          did: string
          feed?: ReadingFeed
          place?: ReadingPlace
        }>
      ).detail
      if (detail?.did !== account.did || (detail.feed ?? 'following') !== feed)
        return
      lastCaptured.current = JSON.stringify(detail.place)
      setUnsaved(lastCaptured.current !== lastSaved.current)
      clearTimeout(timer)
      timer = setTimeout(() => flush(), 750)
    }
    const hidden = () => {
      if (document.visibilityState === 'hidden') {
        clearTimeout(timer)
        flush(true)
      }
    }
    const pagehide = () => {
      clearTimeout(timer)
      flush(true)
    }
    window.addEventListener('skyanchor-place', moved)
    window.addEventListener('pagehide', pagehide)
    document.addEventListener('visibilitychange', hidden)
    const retryPending = setInterval(() => {
      if (pending.current && !writing.current) {
        pending.current = false
        flush()
      }
    }, 1000)
    return () => {
      clearTimeout(timer)
      clearInterval(retryPending)
      window.removeEventListener('skyanchor-place', moved)
      window.removeEventListener('pagehide', pagehide)
      document.removeEventListener('visibilitychange', hidden)
      pending.current = false
    }
  }, [csrf, enabled, account.did, feed])
  const reconnecting = useRef(false)
  useEffect(() => {
    if (
      !csrf &&
      enabled &&
      !reconnecting.current &&
      localStorage.getItem('skyanchor:sync-enabled:' + account.did) === '1'
    ) {
      reconnecting.current = true
      void run(async () => {
        try {
          await renew(true)
        } finally {
          reconnecting.current = false
        }
      })
    }
  }, [enabled, csrf, account.did, account.accessJwt, account.service])
  useEffect(() => {
    const retry = () => {
      if (
        !live.current.csrf &&
        live.current.enabled &&
        !reconnecting.current &&
        localStorage.getItem('skyanchor:sync-enabled:' + account.did) === '1'
      ) {
        reconnecting.current = true
        void live.current.run(async () => {
          try {
            await renew(true)
          } finally {
            reconnecting.current = false
          }
        })
      }
    }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [account.did])
  useEffect(() => {
    if (!csrf || !enabled) return
    const foreground = () => {
      if (document.visibilityState === 'visible')
        void live.current.run(live.current.checkRemote)
    }
    window.addEventListener('focus', foreground)
    window.addEventListener('online', foreground)
    document.addEventListener('visibilitychange', foreground)
    void run(checkRemote)
    return () => {
      window.removeEventListener('focus', foreground)
      window.removeEventListener('online', foreground)
      document.removeEventListener('visibilitychange', foreground)
    }
  }, [csrf, enabled])
  useEffect(() => {
    return () => {
      generation.current++
      automatic.current = false
      pending.current = false
      session.current = {csrf: '', expires: 0}
      setSyncSession(account.did, session.current)
    }
  }, [account.did])

  useEffect(() => {
    if (!enabled) {
      control.close()
      setSlot(undefined)
      return
    }
    // Profile headers become visible after their feed controllers mount.
    const locate = () => {
      const target = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-skyanchor-reading-slot]',
        ),
      ].find(
        node =>
          node.dataset.skyanchorReadingSlot === feed &&
          node.dataset.skyanchorReadingOwner === account.did &&
          node.getClientRects().length > 0,
      )
      if (target) {
        setSlot(target)
        observer.disconnect()
      }
    }
    const observer = new MutationObserver(locate)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
    })
    locate()
    return () => observer.disconnect()
  }, [enabled, feed, account.did, control])

  const indicator =
    loading ||
    (other || attention || notice
      ? l`Needs attention`
      : unsaved
        ? l`Not yet synced`
        : hasNew
          ? l`New posts above`
          : canReturn
            ? l`Return available`
            : '')
  function navigateFromPanel(action: () => void | Promise<void>) {
    const started = generation.current
    control.close(() => {
      if (started === generation.current && live.current.enabled)
        void run(async () => {
          await action()
        })
    })
  }

  if (!enabled || !slot) return null
  return (
    <>
      {createPortal(
        <View>
          <Button
            testID="skyanchor-reading-button"
            label={
              (indicator
                ? l`Reading place` + ': ' + indicator
                : l`Reading place`) +
              (hasNew && indicator !== l`New posts above`
                ? '. ' + l`New posts above`
                : '')
            }
            accessibilityHint={l`Open actions for this feed's independent reading place`}
            aria-expanded={expanded}
            size="small"
            shape="square"
            color="secondary"
            variant="ghost"
            style={{minWidth: 44, minHeight: 44}}
            onPress={() => control.open()}>
            <ButtonIcon icon={ReadingIcon} />
          </Button>
          {!!indicator && (
            <View
              testID="skyanchor-reading-indicator"
              pointerEvents="none"
              style={[
                a.absolute,
                a.rounded_full,
                {
                  top: 5,
                  right: 7,
                  width: 8,
                  height: 8,
                  backgroundColor:
                    other || attention || notice
                      ? t.palette.negative_500
                      : t.palette.primary_500,
                },
              ]}
            />
          )}
        </View>,
        slot,
      )}
      <Dialog.Outer
        control={control}
        onOpen={() => setExpanded(true)}
        onClose={() => setExpanded(false)}>
        <Dialog.ScrollableInner
          label={l`Reading place`}
          style={{maxWidth: 480}}>
          <div
            data-testid="skyanchor-toolbar"
            data-skyanchor-toolbar-feed={feed}>
            <View style={a.gap_md}>
              <Text style={[a.text_xl, a.font_bold, {paddingRight: 32}]}>
                <Trans>Reading place</Trans>
              </Text>
              {feed !== 'following' && (
                <Text>
                  <Trans>This profile tab has its own reading place.</Trans>
                </Text>
              )}
              <Text>
                <Trans>Account</Trans>: @{account.handle}.{' '}
                <Trans>
                  This browser has its own local place and sync consent.
                </Trans>
              </Text>
              <View style={[a.flex_row, a.flex_wrap, a.gap_sm]}>
                <Button
                  label={l`Refresh`}
                  size="large"
                  color="secondary"
                  disabled={busy}
                  onPress={() => navigateFromPanel(onRefresh)}>
                  <ButtonText>
                    <Trans>Refresh</Trans>
                  </ButtonText>
                </Button>
                <Button
                  label={
                    loading
                      ? l`Cancel loading new posts`
                      : l`Load new posts without moving your place`
                  }
                  size="large"
                  color="secondary"
                  disabled={busy && !loading}
                  onPress={() => navigateFromPanel(onLatest)}>
                  <ButtonText>
                    {loading ? (
                      <Trans>Cancel loading new posts</Trans>
                    ) : (
                      <Trans>Load new posts</Trans>
                    )}
                  </ButtonText>
                </Button>
                {canReturn && (
                  <Button
                    label={l`Return to my place`}
                    size="large"
                    color="primary"
                    disabled={busy}
                    onPress={() => navigateFromPanel(onReturn)}>
                    <ButtonText>
                      <Trans>Return to my place</Trans>
                    </ButtonText>
                  </Button>
                )}
                {!csrf ? (
                  <Button
                    label={l`Connect private sync`}
                    size="large"
                    color="secondary"
                    disabled={busy}
                    onPress={() => void run(connect)}>
                    <ButtonText>
                      <Trans>Connect private sync</Trans>
                    </ButtonText>
                  </Button>
                ) : (
                  <>
                    <Button
                      label={l`Save my place`}
                      size="large"
                      color="secondary"
                      disabled={busy}
                      onPress={() => void run(() => save())}>
                      <ButtonText>
                        <Trans>Save my place</Trans>
                      </ButtonText>
                    </Button>
                    <Button
                      label={l`Check other device`}
                      size="large"
                      color="secondary"
                      disabled={busy}
                      onPress={() => void run(checkRemote)}>
                      <ButtonText>
                        <Trans>Check other device</Trans>
                      </ButtonText>
                    </Button>
                  </>
                )}
              </View>
              <Text>
                <Trans>
                  Loading new posts keeps your place. Scroll up to read them.
                </Trans>
              </Text>
              <Text style={t.atoms.text_contrast_high}>
                {!csrf ? (
                  <Trans>Saved locally. Private sync is optional.</Trans>
                ) : attention ? (
                  <Trans>
                    Sync needs attention. Your place is still saved locally;
                    retry the connection or save after resolving the message
                    below.
                  </Trans>
                ) : unsaved ? (
                  <Trans>
                    Local changes are not yet synced. Keep this tab open or
                    retry Save.
                  </Trans>
                ) : (
                  <Trans>
                    Connected to private sync. Save on this browser, then Check
                    other device and Resume there. Only confirmed saves are
                    shared; fetched posts are not marked read.
                  </Trans>
                )}
              </Text>
              {hasNew && (
                <View role="status" testID="skyanchor-new">
                  <Text>
                    <Trans>
                      New posts above. Your reading window has not moved.
                    </Trans>
                  </Text>
                </View>
              )}
              {!!loading && <Text role="status">{loading}</Text>}
              {notice && (
                <Text role="status" testID="skyanchor-fallback">
                  {notice}
                </Text>
              )}
              {status && <Text role="status">{status}</Text>}
              {csrf && (
                <View style={a.gap_sm}>
                  <Button
                    label={l`Reconnect private sync`}
                    size="large"
                    color="secondary"
                    disabled={busy}
                    onPress={() => void run(renew)}>
                    <ButtonText>
                      <Trans>Reconnect private sync</Trans>
                    </ButtonText>
                  </Button>
                  <Button
                    label={l`Delete cloud progress and disconnect`}
                    size="large"
                    color="negative"
                    disabled={busy}
                    onPress={() =>
                      void run(async () => {
                        automatic.current = false
                        pending.current = false
                        const current = await request('place', {
                          method: 'DELETE',
                          body: JSON.stringify({revision: revision.current}),
                        })
                        acceptRevision(current.revision)
                        const started = generation.current
                        const response = await syncSessionRequest(
                          {
                            method: 'DELETE',
                            headers: {'x-skyanchor-csrf': session.current.csrf},
                          },
                          () => started === generation.current,
                        )
                        if (started !== generation.current)
                          throw new Error(
                            l`Account changed; sync response discarded.`,
                          )
                        if (!response.ok)
                          throw new Error(
                            l`Private sync sign-out could not be confirmed.`,
                          )
                        session.current = {csrf: '', expires: 0}
                        setSyncSession(account.did, session.current)
                        localStorage.removeItem(
                          'skyanchor:sync-enabled:' + account.did,
                        )
                        reconnecting.current = false
                        setCsrf('')
                        setOther(undefined)
                        setStatus(
                          l`Cloud progress deleted and sync disconnected. Your local reading place is unchanged.`,
                        )
                      })
                    }>
                    <ButtonText>
                      <Trans>Delete cloud progress and disconnect</Trans>
                    </ButtonText>
                  </Button>
                </View>
              )}
              {other && (
                <View testID="skyanchor-conflict" style={a.gap_sm}>
                  <Text role="alert">
                    <Trans>
                      Another device has a saved place. Choose explicitly; your
                      feed has not moved.
                    </Trans>
                  </Text>
                  <Button
                    label={l`Resume other device`}
                    size="large"
                    color="primary"
                    onPress={() =>
                      navigateFromPanel(async () => {
                        const started = generation.current
                        await resume(other.state ?? undefined)
                        if (
                          started !== generation.current ||
                          !live.current.enabled
                        )
                          throw new Error(
                            l`Account changed; restored sync response discarded.`,
                          )
                        acceptRevision(other.revision)
                        automatic.current = true
                        lastSaved.current = JSON.stringify(other.state)
                        setUnsaved(false)
                        setOther(undefined)
                        setAttention(false)
                        setStatus(
                          l`Other device's saved place restored. Only viewed posts update your place.`,
                        )
                      })
                    }>
                    <ButtonText>
                      <Trans>Resume other device</Trans>
                    </ButtonText>
                  </Button>
                  <Button
                    label={l`Keep mine`}
                    size="large"
                    color="secondary"
                    disabled={busy}
                    onPress={() => void run(() => save(other.revision))}>
                    <ButtonText>
                      <Trans>Keep mine</Trans>
                    </ButtonText>
                  </Button>
                </View>
              )}
            </View>
          </div>
          <Dialog.Close />
        </Dialog.ScrollableInner>
      </Dialog.Outer>
    </>
  )
}
