import {type ReadingFeed, type ReadingPlace} from './domain'

export function useReadingPlace(_options: {
  did: string | undefined
  feed?: ReadingFeed
  scope: string
  enabled: boolean
  headerOffset: number
  keys: string[]
  save: (place: ReadingPlace) => void
}) {
  return {
    notice: '',
    capture: (): ReadingPlace | undefined => undefined,
    snapshot: (): ReadingPlace | undefined => undefined,
    preserve: (_place: ReadingPlace, update: () => void) => update(),
    setTarget: async (
      _place: ReadingPlace | undefined,
      _exact = false,
    ): Promise<void> => {},
  }
}
