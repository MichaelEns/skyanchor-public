import {useCallback} from 'react'
import {WebView} from 'react-native-webview'

import {type EmbedPlayerParams} from '#/lib/strings/embed-player'
import {atoms as a} from '#/alf'

export function PlayerFrame({
  params,
  onLoad,
}: {
  params: EmbedPlayerParams
  onLoad: () => void
}) {
  const onShouldStartLoadWithRequest = useCallback(
    (event: {url: string}) =>
      event.url === params.playerUri ||
      (params.source.startsWith('youtube') &&
        event.url.includes('www.youtube.com')),
    [params.playerUri, params.source],
  )

  return (
    <WebView
      javaScriptEnabled={true}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      bounces={false}
      allowsFullscreenVideo
      nestedScrollEnabled
      source={{uri: params.playerUri}}
      onLoad={onLoad}
      style={a.bg_transparent}
      setSupportMultipleWindows={false}
    />
  )
}
