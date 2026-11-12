import {useEffect, useRef, useState} from 'react'
import {View} from 'react-native'
import {Trans, useLingui} from '@lingui/react/macro'
import {createPortal} from 'react-dom'

import {withRequestDeadline} from '#/lib/async/requestDeadline'
import {formatDateTime} from '#/lib/strings/time'
import {logger} from '#/logger'
import {type SessionAccount, useSession, useSessionApi} from '#/state/session'
import {atoms as a, useTheme} from '#/alf'
import {Button, ButtonIcon, ButtonText} from '#/components/Button'
import * as Dialog from '#/components/Dialog'
import * as TextField from '#/components/forms/TextField'
import {Bookmark_Stroke2_Corner0_Rounded as ReadingIcon} from '#/components/icons/Bookmark'
import * as Select from '#/components/Select'
import {Text} from '#/components/Typography'
import {
  authenticateSyncAccount,
  SyncAuthenticationError,
  syncAuthService,
} from './auth-service'
import {
  boundedSyncJson,
  defaultDeviceName,
  normalizedDeviceName,
  type SavedCheckpoint,
  type SavedDevice,
  validDeviceHistory,
  validDeviceList,
} from './checkpoints'
import {
  type ReadingFeed,
  type ReadingPlace,
  readingStorageKey,
  type ResumeOptions,
  sameReadingPlace,
  type SyncPlace,
  validSyncPlace,
} from './domain'
import {readingIndicator} from './readingStatus'
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
  snapshot,
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
  snapshot: () => ReadingPlace | undefined
  resume: (
    place: ReadingPlace | undefined,
    options: ResumeOptions,
  ) => Promise<boolean>
}) {
  const {t: l, i18n} = useLingui()
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
  const [sharedPlace, setSharedPlace] = useState<Remote | undefined>()
  const [checking, setChecking] = useState(false)
  const [verifiedAt, setVerifiedAt] = useState<number>()
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoringSaved, setRestoringSaved] = useState(false)
  const [devices, setDevices] = useState<SavedDevice[]>([])
  const [source, setSource] = useState('shared')
  const [saves, setSaves] = useState<SavedCheckpoint[]>([])
  const [selectedSave, setSelectedSave] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const historyController = useRef<AbortController | undefined>(undefined)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const historicKey = readingStorageKey(
    'skyanchor:historic-local:',
    account.did,
    feed,
  )
  const historicLocal = useRef(localStorage.getItem(historicKey) === '1')
  const [restoredLocal, setRestoredLocal] = useState(historicLocal.current)
  const [result, setResult] = useState<
    {message: string; error: boolean} | undefined
  >()
  const resumeController = useRef<AbortController | undefined>(undefined)
  const choiceEpoch = useRef(0)
  const checkSequence = useRef(0)
  const activeCheck = useRef(0)
  const scheduleSave = useRef(() => {})
  const writeSettled = useRef<Promise<void> | undefined>(undefined)
  const lifetime = useRef(new AbortController())
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
  const userMoved = useRef(false)
  const pendingPlace = useRef<ReadingPlace | undefined>(undefined)
  const initialShare = useRef(false)
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
    if (value < Math.max(revision.current, observedRevision.current))
      throw new Error(l`Stale sync completion discarded.`)
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
    const value = await privateRequest(path, init, retry)
    if (!validSyncPlace(value, account.did, feed))
      throw new Error(l`Invalid private sync response or account binding`)
    return value
  }
  async function privateRequest(
    path: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<unknown> {
    return withRequestDeadline(
      l`Private sync request`,
      15_000,
      signal => requestWithinDeadline(path, {...init, signal}, retry),
      [init.signal, lifetime.current.signal],
    )
  }
  async function requestWithinDeadline(
    path: string,
    init: RequestInit,
    retry: boolean,
  ): Promise<unknown> {
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
        ((path === 'place' ||
          path === 'devices' ||
          path.startsWith('history?')) &&
        feed !== 'following'
          ? (path.includes('?') ? '&' : '?') +
            'feed=' +
            encodeURIComponent(feed)
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
    const value = await boundedSyncJson(
      response,
      path.startsWith('history?') ? 65_536 : 32_768,
    )
    if (
      started !== generation.current ||
      !live.current.enabled ||
      liveAccount.current?.did !== account.did
    )
      throw new Error(l`Account changed; sync response discarded.`)
    if ((response.status === 401 || response.status === 403) && retry) {
      await renew()
      return privateRequest(path, init, false)
    }
    if (response.status === 409 && path === 'place') {
      if (
        !value ||
        typeof value !== 'object' ||
        !('current' in value) ||
        !validSyncPlace(value.current, account.did, feed)
      ) {
        throw new Error(l`Invalid private sync conflict response`)
      }
      if (
        value.current.revision <
        Math.max(revision.current, observedRevision.current)
      )
        throw new Error(l`Stale sync completion discarded.`)
      setOther(value.current)
      setSharedPlace(value.current)
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
        path === 'place'
          ? l`Profile reading-place capacity reached (64 filters including deleted-place markers). Existing places were not evicted.`
          : l`Browser profile capacity reached (32). Existing names and saved places were not evicted.`,
      )
    if (!response.ok)
      throw new Error(
        l`Private sync failed (${response.status}). Reconnect if the session expired.`,
      )
    return value
  }
  async function loadDevices() {
    const value = await privateRequest('devices')
    if (!validDeviceList(value, account.did, feed))
      throw new Error(l`Invalid saved-device response`)
    setDevices(value.devices)
    setDeviceName(
      value.devices.find(item => item.device === device.current)?.label ?? '',
    )
  }
  async function loadHistory(selected: string) {
    historyController.current?.abort()
    const controller = new AbortController()
    historyController.current = controller
    setHistoryLoading(true)
    try {
      const value = await privateRequest(
        'history?device=' + encodeURIComponent(selected),
        {signal: controller.signal},
      )
      if (controller.signal.aborted || sourceRef.current !== selected) return
      if (!validDeviceHistory(value, account.did, feed, selected))
        throw new Error(l`Invalid saved-place history response`)
      setSaves(value.saves)
      setSelectedSave(
        previous => previous || String(value.saves[0]?.revision ?? ''),
      )
    } catch (error) {
      if (!controller.signal.aborted && sourceRef.current === selected)
        throw error
    } finally {
      if (historyController.current === controller) {
        historyController.current = undefined
        setHistoryLoading(false)
      }
    }
  }
  function chooseSource(value: string) {
    if (!value || value === source || busy || restoring) return
    historyController.current?.abort()
    setSource(value)
    sourceRef.current = value
    setSaves([])
    setSelectedSave('')
    if (value !== 'shared') void run(() => loadHistory(value))
    else setHistoryLoading(false)
  }
  async function checkSavedPlaces() {
    await checkRemote()
    await loadDevices()
    if (sourceRef.current !== 'shared') await loadHistory(sourceRef.current)
  }
  async function renameBrowser() {
    const label = normalizedDeviceName(deviceName)
    if (!label)
      throw new Error(
        l`Use a nonempty browser name of at most 64 characters, without control, invisible, or angle-bracket characters.`,
      )
    const value = await privateRequest('device', {
      method: 'PUT',
      body: JSON.stringify({label}),
    })
    if (
      !value ||
      typeof value !== 'object' ||
      !('did' in value) ||
      value.did !== account.did ||
      !('device' in value) ||
      value.device !== device.current ||
      !('label' in value) ||
      value.label !== label
    )
      throw new Error(l`Invalid browser rename response`)
    await loadDevices()
    setStatus(l`This browser profile was renamed.`)
  }
  async function checkRemote(completingResume = false) {
    if (!session.current.csrf || !enabled) return
    if (resumeController.current && !completingResume) return
    const choice = choiceEpoch.current
    // Only the latest check may reopen saving or replace an explicit decision.
    const sequence = ++checkSequence.current
    activeCheck.current = sequence
    automatic.current = false
    setChecking(true)
    try {
      await writeSettled.current
      if (
        sequence !== checkSequence.current ||
        choice !== choiceEpoch.current ||
        !live.current.enabled
      )
        return
      const current = await request('place')
      if (
        sequence !== checkSequence.current ||
        choice !== choiceEpoch.current ||
        (resumeController.current && !completingResume)
      )
        return
      if (
        current.revision < Math.max(revision.current, observedRevision.current)
      )
        throw new Error(l`Stale sync completion discarded.`)
      observedRevision.current = Math.max(
        observedRevision.current,
        current.revision,
      )
      setSharedPlace(current)
      setVerifiedAt(Date.now())
      const place = live.current.snapshot()
      lastCaptured.current = place ? JSON.stringify(place) : ''
      const matches = sameReadingPlace(place, current.state)
      if (matches) lastCaptured.current = JSON.stringify(current.state)
      const pendingMovement =
        !!place &&
        userMoved.current &&
        sameReadingPlace(place, pendingPlace.current) &&
        current.revision === revision.current &&
        lastSaved.current === JSON.stringify(current.state)
      initialShare.current = current.revision === 0 && !current.state
      setUnsaved(!!place && !matches)
      if (historicLocal.current) {
        setOther(current)
        automatic.current = false
        setUnsaved(true)
        setStatus(
          l`Restored saved place is local only. Latest shared is unchanged. Choose Keep mine or Save my place explicitly to share this view.`,
        )
        return current
      }
      // Revision and last-writer identity are CAS metadata, not viewport evidence.
      if (!matches && !pendingMovement && !initialShare.current) {
        setOther(current)
        setAttention(false)
        setStatus(
          current.state
            ? place
              ? l`The shared place differs from this device. Choose Resume other device to resume the shared place, or Keep mine to share this view. Your viewport has not moved.`
              : l`A shared place is available, but this device's visible position could not be verified. Retry when the feed is visible; your viewport has not moved.`
            : l`There is no shared place to resume. Your local place is unchanged. Use Save my place or Keep mine only on the source browser whose current view you want to share.`,
        )
      } else {
        if (current.revision >= revision.current)
          acceptRevision(current.revision)
        lastSaved.current = JSON.stringify(current.state)
        setUnsaved(
          !!lastCaptured.current &&
            lastCaptured.current !== lastSaved.current &&
            (!!current.state || userMoved.current),
        )
        automatic.current = true
        setOther(undefined)
        setAttention(false)
        setStatus(
          current.state
            ? matches
              ? l`Already at the shared place. Your visible position was checked; your viewport has not moved.`
              : l`Your scrolling is pending automatic saving. Wait for the confirmed-shared caption before resuming elsewhere.`
            : l`Connected. There is no shared saved place for this feed. Confirm Save my place on the source device before trying Resume here.`,
        )
        scheduleSave.current()
      }
      return current
    } catch (error) {
      if (sequence !== checkSequence.current || choice !== choiceEpoch.current)
        return
      throw error
    } finally {
      if (sequence === checkSequence.current) {
        activeCheck.current = 0
        setChecking(false)
      }
    }
  }
  async function run(action: () => Promise<unknown>) {
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
    return withRequestDeadline(
      l`Private sync connection`,
      20_000,
      signal => connectWithinDeadline(reuse, signal),
      [lifetime.current.signal],
    )
  }
  async function connectWithinDeadline(reuse: boolean, signal: AbortSignal) {
    const started = generation.current
    const active = () =>
      started === generation.current &&
      !signal.aborted &&
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
              signal,
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${fresh.accessJwt}`,
              },
              body: JSON.stringify({
                device: device.current,
                service: syncAuthService(fresh.service),
                deviceName: defaultDeviceName(
                  device.current,
                  navigator.userAgent,
                ),
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
        response.status === 422
          ? l`Browser profile capacity reached (32). Existing profiles and saved places were not evicted.`
          : response.status === 401
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
  async function save(
    expectedRevision = historicLocal.current
      ? observedRevision.current
      : revision.current,
    keepalive = false,
  ) {
    if (resumeController.current)
      throw new Error(l`Wait for Resume to finish or cancel it before saving.`)
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
    let finishWrite: () => void = () => {}
    writeSettled.current = new Promise(resolve => {
      finishWrite = resolve
    })
    const started = generation.current
    try {
      if (historicLocal.current) {
        const fresh = await request('place')
        setSharedPlace(fresh)
        observedRevision.current = Math.max(
          observedRevision.current,
          fresh.revision,
        )
        if (fresh.revision !== expectedRevision) {
          setOther(fresh)
          throw new Error(
            l`Latest shared changed. Review it and choose Keep mine again to share this local view.`,
          )
        }
      }
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
      historicLocal.current = false
      localStorage.removeItem(historicKey)
      setRestoredLocal(false)
      setSharedPlace(current)
      lastSaved.current = JSON.stringify(place)
      initialShare.current = false
      userMoved.current = lastCaptured.current !== lastSaved.current
      if (!userMoved.current) pendingPlace.current = undefined
      setUnsaved(
        !!lastCaptured.current && lastCaptured.current !== lastSaved.current,
      )
      setAttention(false)
      setOther(undefined)
      automatic.current = activeCheck.current === 0
      setStatus(l`Private reading place saved.`)
    } finally {
      finishWrite()
      if (started === generation.current) {
        writing.current = false
        writeSettled.current = undefined
      }
    }
  }
  const live = useRef({
    capture,
    snapshot,
    save,
    run,
    checkRemote,
    enabled,
    csrf,
    sharedPlace,
  })
  live.current = {
    capture,
    snapshot,
    save,
    run,
    checkRemote,
    enabled,
    csrf,
    sharedPlace,
  }
  useEffect(() => {
    if (lifetime.current.signal.aborted)
      lifetime.current = new AbortController()
    setBusy(false)
    return () => {
      lifetime.current.abort()
      historyController.current?.abort()
      resumeController.current?.abort()
      resumeController.current = undefined
      setRestoring(false)
      setResult(undefined)
      generation.current++
      activeRuns.current = 0
      writing.current = false
      automatic.current = false
      checkSequence.current++
      activeCheck.current = 0
      pending.current = false
      userMoved.current = false
      pendingPlace.current = undefined
      initialShare.current = false
      setDevices([])
      setSaves([])
      setSource('shared')
      setSelectedSave('')
      setDeviceName('')
    }
  }, [account.did, feed, enabled])
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout>
    const flush = (keepalive = false) => {
      if (
        !automatic.current ||
        historicLocal.current ||
        activeCheck.current ||
        !live.current.enabled ||
        !live.current.csrf
      )
        return
      if (!userMoved.current) return
      if (!lastCaptured.current || lastCaptured.current === lastSaved.current)
        return
      const place = live.current.capture()
      if (!place || JSON.stringify(place) === lastSaved.current) return
      if (!sameReadingPlace(place, pendingPlace.current)) return
      void live.current.run(() =>
        live.current.save(revision.current, keepalive),
      )
    }
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => flush(), 750)
    }
    scheduleSave.current = schedule
    const moved = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          did: string
          feed?: ReadingFeed
          place?: ReadingPlace
          intentional?: boolean
        }>
      ).detail
      if (detail?.did !== account.did || (detail.feed ?? 'following') !== feed)
        return
      lastCaptured.current = JSON.stringify(detail.place)
      if (detail.intentional && detail.place) {
        userMoved.current = true
        pendingPlace.current = detail.place
      } else if (!sameReadingPlace(detail.place, pendingPlace.current)) {
        userMoved.current = false
        pendingPlace.current = undefined
      }
      const shared = live.current.sharedPlace
      if (
        shared &&
        !detail.intentional &&
        !userMoved.current &&
        !initialShare.current &&
        !resumeController.current &&
        !sameReadingPlace(detail.place, shared.state)
      ) {
        automatic.current = false
        setOther(shared)
        setStatus(
          l`The shared place differs from this device. Local restoration has not shared this view. Choose Resume other device or Keep mine explicitly.`,
        )
      }
      setUnsaved(
        !!live.current.csrf &&
          (!!shared?.state || userMoved.current) &&
          lastCaptured.current !== lastSaved.current,
      )
      schedule()
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
    const initial = live.current.capture()
    if (initial) {
      lastCaptured.current = JSON.stringify(initial)
      setUnsaved(
        !!live.current.csrf && lastCaptured.current !== lastSaved.current,
      )
      schedule()
    }
    window.addEventListener('pagehide', pagehide)
    document.addEventListener('visibilitychange', hidden)
    const retryPending = setInterval(() => {
      if (pending.current && !writing.current) {
        pending.current = false
        flush()
      }
    }, 1000)
    return () => {
      if (scheduleSave.current === schedule) scheduleSave.current = () => {}
      clearTimeout(timer)
      clearInterval(retryPending)
      window.removeEventListener('skyanchor-place', moved)
      window.removeEventListener('pagehide', pagehide)
      document.removeEventListener('visibilitychange', hidden)
      pending.current = false
    }
  }, [enabled, account.did, feed])
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
    void run(loadDevices)
    return () => {
      window.removeEventListener('focus', foreground)
      window.removeEventListener('online', foreground)
      document.removeEventListener('visibilitychange', foreground)
    }
  }, [csrf, enabled])
  useEffect(() => {
    return () => {
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

  const restoringLabel = restoringSaved
    ? l`Restoring saved place...`
    : l`Restoring your other device's place...`
  const marker = readingIndicator({
    loading: restoring
      ? restoringLabel
      : checking
        ? l`Checking shared place...`
        : loading,
    remote: !!other,
    error: attention,
    notice,
    unsaved,
    hasNew,
    canReturn,
  })
  const indicator =
    marker.kind === 'error'
      ? l`Sync error` + ': ' + status
      : marker.kind === 'notice'
        ? notice
        : marker.kind === 'remote'
          ? other?.state
            ? l`Other device place available`
            : l`Shared place cleared`
          : marker.kind === 'loading'
            ? restoring
              ? restoringLabel
              : checking
                ? l`Checking shared place...`
                : loading
            : marker.kind === 'unsaved'
              ? l`Not yet synced`
              : marker.kind === 'new'
                ? l`New posts above`
                : marker.kind === 'return'
                  ? l`Return available`
                  : ''
  const connectionLabel = !csrf
    ? l`Not connected`
    : attention
      ? l`Sync error`
      : other
        ? l`Other device decision needed`
        : checking
          ? l`Checking shared place...`
          : unsaved
            ? l`Not yet synced`
            : l`Connected`

  function startResume(checkpoint?: SavedCheckpoint) {
    if ((!other && !checkpoint) || busy || resumeController.current) return
    const selectedDevice = source
    const selectedLabel =
      devices.find(item => item.device === selectedDevice)?.label ??
      defaultDeviceName(selectedDevice)
    const offered: Remote = checkpoint
      ? {did: account.did, feed, device: selectedDevice, ...checkpoint}
      : other!
    const controller = new AbortController()
    resumeController.current = controller
    choiceEpoch.current++
    automatic.current = false
    pending.current = false
    setAttention(false)
    const message = checkpoint
      ? l`Restoring saved place...`
      : l`Restoring your other device's place...`
    setStatus(message)
    setRestoringSaved(!!checkpoint)
    setRestoring(true)
    setBusy(true)
    setResult({
      message,
      error: false,
    })
    const started = generation.current
    control.close(() => {
      if (started !== generation.current || !live.current.enabled) return
      void run(async () => {
        const verify = async () => {
          if (!checkpoint) return
          const current = await request('place', {signal: controller.signal})
          if (!current.state)
            throw new Error(
              l`Cloud progress was deleted. This saved place is no longer available; your local place and Return are preserved.`,
            )
          if (
            current.revision <
            Math.max(revision.current, observedRevision.current)
          )
            throw new Error(l`Stale sync completion discarded.`)
          const history = await privateRequest(
            'history?device=' + encodeURIComponent(selectedDevice),
            {signal: controller.signal},
          )
          if (
            !validDeviceHistory(history, account.did, feed, selectedDevice) ||
            !history.saves.some(
              item => JSON.stringify(item) === JSON.stringify(checkpoint),
            )
          )
            throw new Error(
              l`The selected saved place expired or was deleted. Refresh saved places and choose again.`,
            )
          setSharedPlace(current)
          observedRevision.current = Math.max(
            observedRevision.current,
            current.revision,
          )
        }
        try {
          if (controller.signal.aborted)
            throw new Error(
              l`Resume cancelled. Your original saved place and Return were kept. Retry when ready.`,
            )
          await verify()
          const same = await resume(offered.state ?? undefined, {
            signal: controller.signal,
            verify: checkpoint ? verify : undefined,
            progress: (pages, phase) => {
              if (started === generation.current)
                setResult({
                  message:
                    phase === 'placement'
                      ? l`Placing and saving your exact reading position locally...`
                      : phase === 'revalidate'
                        ? l`Checking the saved post and reply context against current records...`
                        : (checkpoint
                            ? l`Restoring saved place...`
                            : l`Restoring your other device's place...`) +
                          ' ' +
                          l`History pages checked` +
                          ': ' +
                          pages,
                  error: false,
                })
            },
          })
          controller.signal.throwIfAborted()
          if (started !== generation.current || !live.current.enabled)
            throw new Error(
              l`Account changed; restored sync response discarded.`,
            )
          if (checkpoint) {
            historicLocal.current = true
            localStorage.setItem(historicKey, '1')
            setRestoredLocal(true)
          } else {
            acceptRevision(offered.revision)
            historicLocal.current = false
            localStorage.removeItem(historicKey)
            setRestoredLocal(false)
          }
          userMoved.current = false
          pendingPlace.current = undefined
          initialShare.current = false
          lastSaved.current = JSON.stringify(offered.state)
          lastCaptured.current = lastSaved.current
          setUnsaved(!!checkpoint)
          setOther(undefined)
          setAttention(false)
          const savedAt = checkpoint
            ? formatDateTime(i18n, checkpoint.updated, {
                dateStyle: 'medium',
                timeStyle: 'medium',
              })
            : ''
          const message = checkpoint
            ? l`Restored this saved place locally` +
              ': ' +
              selectedLabel +
              ' - ' +
              savedAt +
              '. ' +
              l`Latest shared is unchanged. Sharing requires Save my place or Keep mine.`
            : same
              ? l`Already at the other device's saved place. Confirmed locally.`
              : l`Resumed the other device's saved place. Confirmed locally.`
          setStatus(message)
          setResult({message, error: false})
          try {
            const latest = await checkRemote(true)
            if (
              !checkpoint &&
              latest &&
              !sameReadingPlace(latest.state, offered.state)
            ) {
              const changed = l`The chosen place was restored locally, but the shared place changed during Resume. Automatic sharing is paused. Open Reading place and choose again; your viewport has not moved to the newer place.`
              setStatus(changed)
              setResult({message: changed, error: false})
            }
          } catch (error) {
            throw new Error(
              l`Your place was restored locally, but the latest cloud revision could not be checked. Automatic sync is paused; open Reading place and retry Check other device.` +
                (error instanceof Error ? ' ' + error.message : ''),
            )
          }
        } catch (error) {
          if (started === generation.current) {
            automatic.current = false
            setResult({
              message:
                error instanceof Error
                  ? error.message
                  : l`Resume failed. Open Reading place to retry.`,
              error: true,
            })
          }
          throw error
        } finally {
          if (resumeController.current === controller) {
            resumeController.current = undefined
            setRestoring(false)
          }
        }
      })
    })
  }
  useEffect(() => {
    if (!result || result.error || restoring) return
    const timer = setTimeout(() => setResult(undefined), 6000)
    return () => clearTimeout(timer)
  }, [result, restoring])
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
        <div title={l`Reading place` + ': ' + (indicator || connectionLabel)}>
          <Button
            testID="skyanchor-reading-button"
            label={
              (indicator
                ? l`Reading place` + ': ' + indicator
                : l`Reading place` + ': ' + connectionLabel) +
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
                  backgroundColor: marker.red
                    ? t.palette.negative_500
                    : t.palette.primary_500,
                },
              ]}
            />
          )}
        </div>,
        slot,
      )}
      {result &&
        !expanded &&
        createPortal(
          <div
            data-testid="skyanchor-resume-result"
            style={{
              position: 'fixed',
              bottom: 76,
              right: 12,
              left: 12,
              margin: '0 auto',
              maxWidth: 480,
              zIndex: 100,
            }}>
            <View
              style={[
                a.p_md,
                a.gap_sm,
                a.border,
                a.rounded_md,
                t.atoms.bg,
                t.atoms.border_contrast_medium,
              ]}>
              <Text role={result.error ? 'alert' : 'status'} aria-live="polite">
                {result.message}
              </Text>
              <View style={[a.flex_row, a.gap_sm]}>
                {restoring ? (
                  <Button
                    label={l`Cancel Resume`}
                    size="large"
                    color="secondary"
                    onPress={() => resumeController.current?.abort()}>
                    <ButtonText>
                      <Trans>Cancel Resume</Trans>
                    </ButtonText>
                  </Button>
                ) : (
                  <>
                    {result.error && (
                      <Button
                        label={l`Open Reading place to retry`}
                        size="large"
                        color="secondary"
                        onPress={() => control.open()}>
                        <ButtonText>
                          <Trans>Open Reading place to retry</Trans>
                        </ButtonText>
                      </Button>
                    )}
                    <Button
                      label={l`Dismiss reading-place result`}
                      size="large"
                      color="secondary"
                      onPress={() => setResult(undefined)}>
                      <ButtonText>
                        <Trans>Dismiss</Trans>
                      </ButtonText>
                    </Button>
                  </>
                )}
              </View>
            </View>
          </div>,
          document.body,
        )}
      <Dialog.Outer
        control={control}
        onOpen={() => {
          const place = live.current.snapshot()
          const matches = sameReadingPlace(place, sharedPlace?.state)
          lastCaptured.current = matches
            ? JSON.stringify(sharedPlace?.state)
            : place
              ? JSON.stringify(place)
              : ''
          setUnsaved(
            !!csrf &&
              !!place &&
              !matches &&
              (!!sharedPlace?.state || userMoved.current),
          )
          setExpanded(true)
        }}
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
              <Text testID="skyanchor-source-state" role="status">
                {restoredLocal ? (
                  <Trans>
                    Restored saved place is local only. Latest shared is
                    unchanged. Scrolling, Return, and reopening do not share it.
                    Choose Save my place or Keep mine explicitly, or Resume
                    other device to return to latest shared.
                  </Trans>
                ) : !csrf ? (
                  <Trans>
                    Saved only on this device. Connect to check the shared
                    place.
                  </Trans>
                ) : other?.state ? (
                  <Trans>
                    New scrolling is saved only on this device until you Resume
                    or Keep mine. Choose Keep mine only on the browser whose
                    current place you want to share.
                  </Trans>
                ) : other ? (
                  <Trans>
                    There is no shared place to resume. Your local place stays
                    saved only on this device. Save my place or Keep mine
                    explicitly shares this view.
                  </Trans>
                ) : attention ? (
                  <Trans>
                    Your current local place is not confirmed shared. Automatic
                    saving needs attention; resolve the error and Check other
                    device or reconnect.
                  </Trans>
                ) : checking ? (
                  <Trans>
                    Checking the shared place. Local scrolling is pending until
                    this check completes.
                  </Trans>
                ) : sharedPlace && !sharedPlace.state && !userMoved.current ? (
                  <Trans>
                    There is no shared place to resume. Your local place is
                    unchanged. Save my place explicitly shares this view; a
                    deleted shared place stays cleared until an explicit save.
                  </Trans>
                ) : unsaved ? (
                  <Trans>
                    Your current local place is not confirmed shared. Keep this
                    browser open for automatic saving; wait for confirmation
                    before resuming elsewhere.
                  </Trans>
                ) : sharedPlace?.state &&
                  lastCaptured.current === JSON.stringify(sharedPlace.state) ? (
                  <Trans>
                    Current local place confirmed shared. Further scrolling
                    saves automatically while this browser is active. Fetched
                    posts are not marked read.
                  </Trans>
                ) : (
                  <Trans>
                    No current local place has been confirmed shared for this
                    feed.
                  </Trans>
                )}
              </Text>
              {!!csrf && (
                <View style={a.gap_sm}>
                  <Text style={a.font_bold}>
                    <Trans>Source of saved place</Trans>
                  </Text>
                  <Select.Root
                    value={source}
                    onValueChange={chooseSource}
                    disabled={busy || restoring}>
                    <Select.Trigger label={l`Source of saved place`}>
                      {({props}) => (
                        <Button
                          {...props}
                          label={l`Source of saved place`}
                          size="large"
                          color="secondary"
                          style={[a.w_full, {minHeight: 44}]}>
                          <Select.ValueText style={{flexShrink: 1}} />
                          <Select.Icon />
                        </Button>
                      )}
                    </Select.Trigger>
                    <Select.Content
                      label={l`Source of saved place`}
                      items={[
                        {value: 'shared', label: l`Latest shared place`},
                        ...devices.map(item => ({
                          value: item.device,
                          label:
                            item.label +
                            ' [' +
                            item.device.slice(0, 4) +
                            ']' +
                            (item.device === device.current
                              ? ' - ' + l`This browser`
                              : '') +
                            ' - ' +
                            (item.lastSaved
                              ? l`Saved` +
                                ' ' +
                                formatDateTime(i18n, item.lastSaved, {
                                  dateStyle: 'medium',
                                  timeStyle: 'medium',
                                })
                              : l`No saved place in this feed`),
                        })),
                      ]}
                      renderItem={({value, label}) => (
                        <Select.Item value={value} label={label}>
                          <Select.ItemIndicator />
                          <Select.ItemText>{label}</Select.ItemText>
                        </Select.Item>
                      )}
                    />
                  </Select.Root>
                  <Text>
                    <Trans>
                      Times show server-confirmed saves, not post age or last
                      device use. Saved recently can point to an older post.
                    </Trans>
                  </Text>
                  {source !== 'shared' && (
                    <>
                      {historyLoading ? (
                        <Text role="status">
                          <Trans>Loading saved places...</Trans>
                        </Text>
                      ) : saves.length ? (
                        <Select.Root
                          value={selectedSave}
                          onValueChange={setSelectedSave}
                          disabled={busy || restoring}>
                          <Select.Trigger label={l`Saved place`}>
                            {({props}) => (
                              <Button
                                {...props}
                                label={l`Saved place`}
                                size="large"
                                color="secondary"
                                style={[a.w_full, {minHeight: 44}]}>
                                <Select.ValueText style={{flexShrink: 1}} />
                                <Select.Icon />
                              </Button>
                            )}
                          </Select.Trigger>
                          <Select.Content
                            label={l`Saved place`}
                            items={saves.map((item, index) => ({
                              value: String(item.revision),
                              label:
                                (index === 0
                                  ? l`Latest save`
                                  : index === 1
                                    ? l`Previous save`
                                    : l`Older save`) +
                                ' - ' +
                                formatDateTime(i18n, item.updated, {
                                  dateStyle: 'medium',
                                  timeStyle: 'medium',
                                }),
                            }))}
                            renderItem={({value, label}) => (
                              <Select.Item value={value} label={label}>
                                <Select.ItemIndicator />
                                <Select.ItemText>{label}</Select.ItemText>
                              </Select.Item>
                            )}
                          />
                        </Select.Root>
                      ) : (
                        <Text role="status">
                          <Trans>
                            No saved places are available for this browser in
                            this feed. Check saved places to refresh.
                          </Trans>
                        </Text>
                      )}
                      {!!saves.length &&
                        !saves.some(
                          item => String(item.revision) === selectedSave,
                        ) && (
                          <Text role="alert">
                            <Trans>
                              The selected save expired. Choose an available
                              saved place.
                            </Trans>
                          </Text>
                        )}
                      <Button
                        label={l`Resume saved place`}
                        size="large"
                        color="primary"
                        disabled={
                          busy ||
                          restoring ||
                          historyLoading ||
                          !saves.some(
                            item => String(item.revision) === selectedSave,
                          )
                        }
                        onPress={() =>
                          startResume(
                            saves.find(
                              item => String(item.revision) === selectedSave,
                            ),
                          )
                        }>
                        <ButtonText>
                          <Trans>Resume saved place</Trans>
                        </ButtonText>
                      </Button>
                    </>
                  )}
                  <Button
                    label={l`Check saved places`}
                    size="large"
                    color="secondary"
                    disabled={busy}
                    onPress={() => void run(checkSavedPlaces)}>
                    <ButtonText>
                      <Trans>Check saved places</Trans>
                    </ButtonText>
                  </Button>
                  <TextField.LabelText>
                    <Trans>Name this browser profile</Trans>
                  </TextField.LabelText>
                  <TextField.Root>
                    <TextField.Input
                      label={l`Name this browser profile`}
                      value={deviceName}
                      onChangeText={setDeviceName}
                      editable={!busy}
                      maxLength={128}
                      autoComplete="off"
                    />
                  </TextField.Root>
                  <Button
                    label={l`Save browser name`}
                    size="large"
                    color="secondary"
                    disabled={busy || !deviceName.trim()}
                    onPress={() => void run(renameBrowser)}>
                    <ButtonText>
                      <Trans>Save browser name</Trans>
                    </ButtonText>
                  </Button>
                  <Text>
                    <Trans>
                      Names are private to this account. A browser profile is
                      not a physical machine; websites cannot read your computer
                      name. Different profiles or installed apps may have
                      different IDs.
                    </Trans>
                  </Text>
                </View>
              )}
              {sharedPlace && (
                <Text emoji testID="skyanchor-shared-save">
                  {sharedPlace.state && sharedPlace.updated
                    ? l`Shared checkpoint last saved` +
                      ': ' +
                      formatDateTime(i18n, sharedPlace.updated, {
                        dateStyle: 'medium',
                        timeStyle: 'medium',
                      }) +
                      '. ' +
                      (devices.find(item => item.device === sharedPlace.device)
                        ?.label ??
                        defaultDeviceName(sharedPlace.device ?? '')) +
                      ' [' +
                      sharedPlace.device?.slice(0, 4) +
                      ']' +
                      ' - ' +
                      (sharedPlace.device === device.current
                        ? l`This browser`
                        : l`Another browser`)
                    : l`No server-confirmed save time is available for this feed.`}
                </Text>
              )}
              {verifiedAt && (
                <Text testID="skyanchor-last-verified">
                  {l`Shared place last checked` +
                    ': ' +
                    formatDateTime(i18n, verifiedAt, {
                      dateStyle: 'medium',
                      timeStyle: 'medium',
                    }) +
                    '. ' +
                    l`A browser label does not prove that its current view matches. If the source's recent view is not confirmed shared, it is not available here yet.`}
                </Text>
              )}
              <Text testID="skyanchor-connection-status" style={a.font_bold}>
                {connectionLabel}
              </Text>
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
                      onPress={() => void run(checkSavedPlaces)}>
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
              <Text>
                <Trans>
                  On the source device, wait for the confirmed-shared caption
                  after scrolling, or use Save my place and wait for
                  confirmation. In this browser, open the same feed, Connect,
                  then Resume other device. Following and each profile tab keep
                  separate places.
                </Trans>
              </Text>
              <Text>
                <Trans>
                  Dot legend: red means an error, reading notice, or
                  other-device decision; open this panel for the reason. Blue
                  means loading, not yet synced, new posts above, or Return
                  available, in that order. Errors and notices take priority
                  over other-device offers. No dot only means none of these
                  applies: it does not prove a connection or a confirmed save.
                </Trans>
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
              {status && status !== result?.message && (
                <Text role="status">{status}</Text>
              )}
              {result && (
                <Text role={result.error ? 'alert' : 'status'}>
                  {result.message}
                </Text>
              )}
              {restoring && (
                <Button
                  label={l`Cancel Resume`}
                  size="large"
                  color="secondary"
                  onPress={() => resumeController.current?.abort()}>
                  <ButtonText>
                    <Trans>Cancel Resume</Trans>
                  </ButtonText>
                </Button>
              )}
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
                        setDevices([])
                        setSaves([])
                        setSelectedSave('')
                        setSource('shared')
                        setDeviceName('')
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
                    {other.state && !lastCaptured.current ? (
                      <Trans>
                        A shared place is available, but this device's visible
                        position could not be verified. Retry when the feed is
                        visible.
                      </Trans>
                    ) : other.state ? (
                      <Trans>
                        The shared place differs from this device. Resume other
                        device resumes that shared place, even if this browser
                        saved it previously. Choose explicitly; your feed has
                        not moved.
                      </Trans>
                    ) : (
                      <Trans>
                        The shared place was cleared. There is no remote place
                        to resume. Your local place is unchanged; Keep mine
                        shares it explicitly.
                      </Trans>
                    )}
                  </Text>
                  {other.state && (
                    <Button
                      label={l`Resume other device`}
                      size="large"
                      color="primary"
                      disabled={busy || restoring}
                      onPress={() => startResume()}>
                      <ButtonText>
                        <Trans>Resume other device</Trans>
                      </ButtonText>
                    </Button>
                  )}
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
