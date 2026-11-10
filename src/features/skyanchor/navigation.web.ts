export function captureReadingDeparture(target: unknown) {
  window.dispatchEvent(
    new CustomEvent('skyanchor-before-navigation', {detail: {target}}),
  )
}

export function restoreReadingEntry(routeKey: string | undefined) {
  const detail = {routeKey, handled: false}
  window.dispatchEvent(
    new CustomEvent('skyanchor-restore-navigation', {detail}),
  )
  return detail.handled
}
