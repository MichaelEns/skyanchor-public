declare const clients: Clients
declare function skipWaiting(): Promise<void>
declare function addEventListener<
  K extends keyof ServiceWorkerGlobalScopeEventMap,
>(
  type: K,
  listener: (
    this: ServiceWorkerGlobalScope,
    event: ServiceWorkerGlobalScopeEventMap[K],
  ) => void,
): void
