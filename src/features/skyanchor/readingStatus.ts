export function readingIndicator({
  loading,
  remote,
  error,
  notice,
  unsaved,
  hasNew,
  canReturn,
}: {
  loading: string
  remote: boolean
  error: boolean
  notice: string
  unsaved: boolean
  hasNew: boolean
  canReturn: boolean
}) {
  const kind = error
    ? 'error'
    : notice
      ? 'notice'
      : remote
        ? 'remote'
        : loading
          ? 'loading'
          : unsaved
            ? 'unsaved'
            : hasNew
              ? 'new'
              : canReturn
                ? 'return'
                : 'quiet'
  return {kind, red: error || !!notice || remote}
}
