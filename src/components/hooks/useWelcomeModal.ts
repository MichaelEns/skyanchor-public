import {useEffect, useEffectEvent, useRef, useState} from 'react'

import {useSession} from '#/state/session'
import {useLoggedOutView} from '#/state/shell/logged-out'
import {IS_WEB} from '#/env'
import {type WelcomeModalControl} from './useWelcomeModal.shared'

export function useWelcomeModal(): WelcomeModalControl {
  const {hasSession} = useSession()
  const {showLoggedOut} = useLoggedOutView()
  const [isOpen, setIsOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const open = () => setIsOpen(true)
  const cancelPresentation = () => {
    clearTimeout(timer.current)
    timer.current = undefined
  }
  const close = () => {
    cancelPresentation()
    setIsOpen(false)
  }
  const presentIfEligible = useEffectEvent(() => {
    timer.current = undefined
    if (!hasSession && !showLoggedOut && window.location.pathname === '/') {
      setIsOpen(true)
    }
  })

  useEffect(() => {
    if (
      IS_WEB &&
      !hasSession &&
      !showLoggedOut &&
      typeof window !== 'undefined'
    ) {
      const currentPath = window.location.pathname
      const isHomePage = currentPath === '/'
      const hasModalBeenShown =
        localStorage.getItem('welcomeModalShown') === 'true'

      if (isHomePage && !hasModalBeenShown) {
        localStorage.setItem('welcomeModalShown', 'true')
        timer.current = setTimeout(presentIfEligible, 1000)
      }
    }
    return cancelPresentation
  }, [hasSession, showLoggedOut])

  return {isOpen, open, close}
}
