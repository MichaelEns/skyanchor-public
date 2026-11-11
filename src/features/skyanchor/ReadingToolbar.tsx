import {type SessionAccount} from '#/state/session'
import {type ReadingFeed, type ReadingPlace, type ResumeOptions} from './domain'

export function ReadingToolbar(_props: {
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
  return null
}
