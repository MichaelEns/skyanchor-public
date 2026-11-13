import {useLingui} from '@lingui/react/macro'

import {type EmbedPlayerParams} from '#/lib/strings/embed-player'
import {atoms as a} from '#/alf'
import {PlayerFrame as WebViewPlayer} from './WebViewPlayer'

export function PlayerFrame({
  params,
  onLoad,
}: {
  params: EmbedPlayerParams
  onLoad: () => void
}) {
  const {t: l} = useLingui()

  if (params.source !== 'youtube' && params.source !== 'youtubeShorts') {
    return <WebViewPlayer params={params} onLoad={onLoad} />
  }

  return (
    <iframe
      title={l`YouTube video player`}
      data-testid="youtube-player"
      src={params.playerUri}
      onLoad={onLoad}
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen
      referrerPolicy="origin"
      style={{
        ...a.w_full,
        ...a.h_full,
        ...a.border_0,
        ...a.bg_transparent,
      }}
    />
  )
}
