import {useEffect, useState} from 'react'
import {Trans} from '@lingui/react/macro'

import {logger} from '#/logger'
import {Text} from '#/components/Typography'

export function PwaUpdates() {
  const [waiting, setWaiting] = useState<ServiceWorker>()
  const [failed, setFailed] = useState(false)
  const [captureFailed, setCaptureFailed] = useState(false)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let active = true
    const wasControlled = !!navigator.serviceWorker.controller
    void navigator.serviceWorker.register('/sw.js').then(
      registration => {
        if (!registration || !active) return
        const isUpgrade = wasControlled || !!registration.active
        if (registration.waiting && isUpgrade) setWaiting(registration.waiting)
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing
          installing?.addEventListener('statechange', () => {
            if (
              active &&
              installing.state === 'installed' &&
              isUpgrade &&
              registration.waiting === installing
            )
              setWaiting(installing)
          })
        })
      },
      error => {
        logger.error('SkyAnchor PWA registration failed', {message: error})
        if (active) setFailed(true)
      },
    )
    return () => {
      active = false
    }
  }, [])
  if (!waiting && !failed && !captureFailed) return null
  return (
    <div
      data-testid="skyanchor-pwa"
      style={{
        position: 'fixed',
        bottom: 8,
        right: 8,
        zIndex: 100,
        background: '#fff',
        padding: 12,
      }}>
      {failed && (
        <Text>
          <Trans>SkyAnchor update registration failed.</Trans>
        </Text>
      )}
      {captureFailed && (
        <Text>
          <Trans>
            Could not save your reading place. Update was not applied.
          </Trans>
        </Text>
      )}
      {waiting && (
        <>
          <button
            onClick={() => {
              const attempt = {failed: false}
              window.dispatchEvent(
                new CustomEvent('skyanchor-save-now', {detail: attempt}),
              )
              if (attempt.failed) {
                setCaptureFailed(true)
                return
              }
              setCaptureFailed(false)
              navigator.serviceWorker.addEventListener(
                'controllerchange',
                () => window.location.reload(),
                {once: true},
              )
              waiting.postMessage('ACTIVATE_SKYANCHOR_UPDATE')
            }}>
            <Text>
              <Trans>Update SkyAnchor safely</Trans>
            </Text>
          </button>
          <button
            onClick={() => {
              setWaiting(undefined)
              setCaptureFailed(false)
            }}>
            <Text>
              <Trans>Not now</Trans>
            </Text>
          </button>
        </>
      )}
    </div>
  )
}
