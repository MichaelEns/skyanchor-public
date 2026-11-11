import {readingIndicator} from './readingStatus'

const quiet = {
  loading: '',
  remote: false,
  error: false,
  notice: '',
  unsaved: false,
  hasNew: false,
  canReturn: false,
}

it('has no dot for quiet state independently of whether private sync is connected', () => {
  expect(readingIndicator(quiet)).toEqual({kind: 'quiet', red: false})
})

it.each([
  [{remote: true}, 'remote', true],
  [{error: true}, 'error', true],
  [{notice: 'Reading notice'}, 'notice', true],
  [{unsaved: true}, 'unsaved', false],
  [{hasNew: true}, 'new', false],
  [{canReturn: true}, 'return', false],
  [{loading: 'Loading'}, 'loading', false],
  [
    {
      remote: true,
      error: true,
      notice: 'Notice',
      loading: 'Loading',
      unsaved: true,
    },
    'error',
    true,
  ],
  [{remote: true, notice: 'Notice', loading: 'Loading'}, 'notice', true],
  [{remote: true, loading: 'Loading'}, 'remote', true],
  [
    {loading: 'Loading', unsaved: true, hasNew: true, canReturn: true},
    'loading',
    false,
  ],
  [{unsaved: true, hasNew: true, canReturn: true}, 'unsaved', false],
  [{hasNew: true, canReturn: true}, 'new', false],
] as const)(
  'reports the highest-priority reason and truthful color for %j',
  (state, kind, red) => {
    expect(readingIndicator({...quiet, ...state})).toEqual({kind, red})
  },
)
