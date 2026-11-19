import {useEffect} from 'react'

import {logger} from '#/logger'
import {useShellLayout} from '#/state/shell/shell-layout'

export function viewportEdges(
  layoutHeight: number,
  viewport: {height: number; offsetTop: number; scale: number} | undefined,
  editing: boolean,
  boundary?: {scrollY: number; maxScrollY: number},
) {
  if (!viewport) return {top: 0, bottom: 0}
  const {height, offsetTop, scale} = viewport
  if (
    ![layoutHeight, height, offsetTop, scale].every(Number.isFinite) ||
    layoutHeight <= 0 ||
    height <= 0 ||
    scale <= 0
  )
    throw new Error('Invalid visual viewport geometry')
  // Let pinch panning and the keyboard retain browser-owned layout behavior.
  if (scale !== 1 || (editing && layoutHeight - height > 150))
    return {top: 0, bottom: 0}
  let top = offsetTop
  if (boundary) {
    const {scrollY, maxScrollY} = boundary
    // Elastic translation is not Safari chrome's independent height divergence.
    if (top < 0 && (scrollY <= 0 || scrollY >= maxScrollY)) top = 0
    if (top > 0 && scrollY > maxScrollY)
      top -= Math.min(top, scrollY - maxScrollY)
  }
  return {top, bottom: layoutHeight - top - height}
}

export function useWebViewport() {
  const {footerHeight} = useShellLayout()
  useEffect(() => {
    const viewport = window.visualViewport
    const root = document.documentElement
    let frame = 0
    let settling: ReturnType<typeof setTimeout>[] = []
    let reportedInvalid = false
    const update = () => {
      frame = 0
      if (document.visibilityState === 'hidden') return
      const active = document.activeElement
      const editing =
        active instanceof HTMLElement &&
        (active.matches('input, textarea') || active.isContentEditable)
      let edges
      try {
        edges = viewportEdges(
          root.clientHeight,
          window.visualViewport ?? undefined,
          editing,
          {
            scrollY: window.scrollY,
            maxScrollY: Math.max(0, root.scrollHeight - root.clientHeight),
          },
        )
      } catch (error) {
        if (!reportedInvalid) {
          logger.error('Could not position web shell: invalid viewport', {
            safeMessage: error,
          })
          reportedInvalid = true
        }
        return
      }
      reportedInvalid = false
      root.style.setProperty('--skyanchor-viewport-top', `${edges.top}px`)
      root.style.setProperty('--skyanchor-viewport-bottom', `${edges.bottom}px`)
      const footer = document.querySelector<HTMLElement>(
        '[data-testid="mobileBottomBar"]',
      )
      if (footer?.getClientRects().length) {
        const height = footer.getBoundingClientRect().height
        if (
          Number.isFinite(height) &&
          height > 0 &&
          footerHeight.get() !== height
        )
          footerHeight.set(height)
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const stopSettling = () => {
      for (const timer of settling) clearTimeout(timer)
      settling = []
    }
    const reconcile = () => {
      stopSettling()
      // A suspended frame or the first restored viewport reading may be stale.
      cancelAnimationFrame(frame)
      frame = 0
      if (document.visibilityState === 'hidden') return
      update()
      settling = [50, 150, 300, 600, 1000, 1500].map(delay =>
        setTimeout(schedule, delay),
      )
    }
    reconcile()
    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(root)
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, {passive: true})
    window.addEventListener('pageshow', reconcile)
    window.addEventListener('focus', reconcile)
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    document.addEventListener('visibilitychange', reconcile)
    return () => {
      stopSettling()
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('pageshow', reconcile)
      window.removeEventListener('focus', reconcile)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
      document.removeEventListener('visibilitychange', reconcile)
      root.style.removeProperty('--skyanchor-viewport-top')
      root.style.removeProperty('--skyanchor-viewport-bottom')
    }
  }, [footerHeight])
}
