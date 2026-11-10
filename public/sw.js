/* No fetch handler: private API responses, media and account data are never cached. */
addEventListener('install', () => {})
addEventListener('activate', event => event.waitUntil(clients.claim()))
addEventListener('message', event => {
  if (event.data === 'ACTIVATE_SKYANCHOR_UPDATE') event.waitUntil(skipWaiting())
})
