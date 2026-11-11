/*
 * This is a reimplementation of what exists in our HTML template files
 * already. Once the React tree mounts, this is what gets rendered first, until
 * the app is ready to go.
 */

import {useEffect, useRef, useState} from 'react'
import Svg, {Path} from 'react-native-svg'

import {ANCHOR_PATH} from '#/view/icons/Logo'
import {atoms as a, flattenToCSS} from '#/alf'
import {startupPhase} from '#/features/skyanchor/StartupRecovery'

const size = 100

export function Splash({
  isReady,
  children,
}: React.PropsWithChildren<{
  isReady: boolean
}>) {
  const [isAnimationComplete, setIsAnimationComplete] = useState(false)
  const splashRef = useRef<HTMLDivElement>(null)

  // hide the static one that's baked into the HTML - gets replaced by our React version below
  useEffect(() => {
    // double rAF ensures that the React version gets painted first
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const splash = document.getElementById('splash')
        if (splash) {
          splash.remove()
        }
      })
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
    }
  }, [])

  // when ready, we fade/scale out
  useEffect(() => {
    if (!isReady) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let animation: Animation | undefined
    const started = Date.now()
    const reconcile = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - started >= 300
      ) {
        complete()
      }
    }
    const cleanup = () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', reconcile)
      window.removeEventListener('pageshow', reconcile)
      if (animation) {
        animation.onfinish = null
        animation.oncancel = null
        animation.cancel()
      }
    }
    const complete = () => {
      if (!active) return
      active = false
      cleanup()
      document.getElementById('splash')?.remove()
      setIsAnimationComplete(true)
      startupPhase('ready')
    }

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    const node = splashRef.current
    if (!node || reduceMotion) {
      complete()
      return
    }

    animation = node.animate(
      [
        {opacity: 1, transform: 'scale(1)'},
        {opacity: 0, transform: 'scale(1.5)'},
      ],
      {
        duration: 300,
        easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        fill: 'forwards',
      },
    )
    animation.onfinish = complete
    animation.oncancel = complete
    timer = setTimeout(complete, 500)
    document.addEventListener('visibilitychange', reconcile)
    window.addEventListener('pageshow', reconcile)

    return () => {
      active = false
      cleanup()
    }
  }, [isReady])

  return (
    <>
      {isReady && children}

      {!isAnimationComplete && (
        <div
          ref={splashRef}
          style={flattenToCSS([
            a.fixed,
            a.inset_0,
            a.flex,
            a.align_center,
            a.justify_center,
            // to compensate for the `top: -50px` below
            {transformOrigin: 'center calc(50% - 50px)'},
          ])}>
          <Svg
            fill="none"
            viewBox="0 0 24 24"
            style={[a.relative, {width: size, height: size, top: -50}]}>
            <Path fill="#287c87" d={ANCHOR_PATH} />
          </Svg>
        </div>
      )}
    </>
  )
}
