import {useEffect} from 'react'

import {logger} from '#/logger'

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
  useEffect(() => {
    const viewport = window.visualViewport
    const root = document.documentElement
    let frame = 0
    let reportedInvalid = false
    const update = () => {
      frame = 0
      const active = document.activeElement
      const editing =
        active instanceof HTMLElement &&
        (active.matches('input, textarea') || active.isContentEditable)
      let edges
      try {
        edges = viewportEdges(
          root.clientHeight,
          viewport ?? undefined,
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
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, {passive: true})
    window.addEventListener('pageshow', schedule)
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    document.addEventListener('visibilitychange', schedule)
    return () => {
      cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('pageshow', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
      document.removeEventListener('visibilitychange', schedule)
      root.style.removeProperty('--skyanchor-viewport-top')
      root.style.removeProperty('--skyanchor-viewport-bottom')
    }
  }, [])
}
