import {useSession} from '#/state/session'
import {type ReadingFeed} from './domain'

export function ReadingPlaceSlot({feed}: {feed: ReadingFeed}) {
  const {currentAccount} = useSession()
  if (!currentAccount) return null
  return (
    <div
      data-skyanchor-reading-slot={feed}
      data-skyanchor-reading-owner={currentAccount.did}
      style={{width: 48, minHeight: 44, flexShrink: 0}}
    />
  )
}
