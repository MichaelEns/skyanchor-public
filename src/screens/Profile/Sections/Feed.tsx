import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import {View} from 'react-native'
import {msg} from '@lingui/core/macro'
import {useLingui} from '@lingui/react'
import {Trans} from '@lingui/react/macro'
import {useQueryClient} from '@tanstack/react-query'

import {useInitialNumToRender} from '#/lib/hooks/useInitialNumToRender'
import {
  type FeedDescriptor,
  RQKEY as FEED_RQKEY,
} from '#/state/queries/post-feed'
import {truncateAndInvalidate} from '#/state/queries/util'
import {useSession} from '#/state/session'
import {PostFeed, type PostFeedRef} from '#/view/com/posts/PostFeed'
import {
  EmptyState,
  type EmptyStateButtonProps,
} from '#/view/com/util/EmptyState'
import {type ListRef} from '#/view/com/util/List'
import {findListNativeTag} from '#/view/com/util/listNativeTag'
import {LoadLatestBtn} from '#/view/com/util/load-latest/LoadLatestBtn'
import {atoms as a, ios, useTheme} from '#/alf'
import {EditBig_Stroke1_Corner0_Rounded as EditIcon} from '#/components/icons/EditBig'
import {Text} from '#/components/Typography'
import {IS_IOS, IS_NATIVE, IS_WEB} from '#/env'
import {validReadingFeed} from '#/features/skyanchor/domain'
import {type SectionRef} from './types'

interface FeedSectionProps {
  ref?: React.Ref<SectionRef>
  feed: FeedDescriptor
  headerHeight: number
  isFocused: boolean
  scrollElRef: ListRef
  ignoreFilterFor?: string
  setScrollViewTag: (tag: number | null) => void
  emptyStateMessage?: string
  emptyStateButton?: EmptyStateButtonProps
  emptyStateIcon?: React.ComponentType<any> | React.ReactElement
  postFeedRef?: React.Ref<PostFeedRef>
}

export function ProfileFeedSection({
  ref,
  feed,
  headerHeight,
  isFocused,
  scrollElRef,
  ignoreFilterFor,
  setScrollViewTag,
  emptyStateMessage,
  emptyStateButton,
  emptyStateIcon,
  postFeedRef,
}: FeedSectionProps) {
  const {_} = useLingui()
  const queryClient = useQueryClient()
  const {currentAccount} = useSession()
  const readingFeedRef = useRef<PostFeedRef>(null)
  useImperativeHandle(postFeedRef, () => ({
    refreshFeed: async () => {
      if (!readingFeedRef.current)
        throw new Error('Profile feed is not mounted')
      await readingFeedRef.current.refreshFeed()
    },
    loadNewer: async () => {
      if (!readingFeedRef.current)
        throw new Error('Profile feed is not mounted')
      await readingFeedRef.current.loadNewer()
    },
  }))
  const [hasNew, setHasNew] = useState(false)
  const [newerStatus, setNewerStatus] = useState('')
  const [isScrolledDown, setIsScrolledDown] = useState(false)
  const shouldUseAdjustedNumToRender = feed.endsWith('posts_and_author_threads')
  const isVideoFeed = IS_NATIVE && feed.endsWith('posts_with_video')
  const adjustedInitialNumToRender = useInitialNumToRender({
    screenHeightOffset: headerHeight,
  })
  const onScrollToTop = useCallback(() => {
    if (IS_WEB && currentAccount && validReadingFeed(feed)) {
      void readingFeedRef.current?.loadNewer()
      return
    }
    scrollElRef.current?.scrollToOffset({
      animated: IS_NATIVE,
      offset: -headerHeight,
    })
    truncateAndInvalidate(queryClient, FEED_RQKEY(feed))
    setHasNew(false)
  }, [scrollElRef, headerHeight, queryClient, feed, setHasNew, currentAccount])

  useImperativeHandle(ref, () => ({
    scrollToTop: onScrollToTop,
  }))

  const renderPostsEmpty = useCallback(() => {
    return (
      <View style={[a.flex_1, a.justify_center, a.align_center]}>
        <EmptyState
          style={{width: '100%'}}
          icon={emptyStateIcon || EditIcon}
          iconSize="3xl"
          message={emptyStateMessage || _(msg`No posts yet`)}
          button={emptyStateButton}
        />
      </View>
    )
  }, [_, emptyStateButton, emptyStateIcon, emptyStateMessage])

  useEffect(() => {
    if (IS_IOS && isFocused && scrollElRef.current) {
      const nativeTag = findListNativeTag(scrollElRef.current)
      setScrollViewTag(nativeTag)
    }
  }, [isFocused, scrollElRef, setScrollViewTag])

  return (
    <View>
      <PostFeed
        testID="postsFeed"
        enabled={isFocused}
        feed={feed}
        scrollElRef={scrollElRef}
        onHasNew={setHasNew}
        onNewerStatus={setNewerStatus}
        onScrolledDownChange={setIsScrolledDown}
        renderEmptyState={renderPostsEmpty}
        headerOffset={headerHeight}
        progressViewOffset={ios(0)}
        renderEndOfFeed={isVideoFeed ? undefined : ProfileEndOfFeed}
        ignoreFilterFor={ignoreFilterFor}
        initialNumToRender={
          shouldUseAdjustedNumToRender ? adjustedInitialNumToRender : undefined
        }
        isVideoFeed={isVideoFeed}
        ref={readingFeedRef}
      />
      {(isScrolledDown || hasNew || !!newerStatus) && (
        <LoadLatestBtn
          onPress={onScrollToTop}
          status={newerStatus}
          label={
            newerStatus ||
            (IS_WEB && validReadingFeed(feed)
              ? _(msg`Load new posts without moving your place`)
              : _(msg`Load new posts`))
          }
          showIndicator={hasNew}
        />
      )}
    </View>
  )
}

function ProfileEndOfFeed() {
  const t = useTheme()

  return (
    <View style={[a.w_full, a.py_5xl, a.border_t, t.atoms.border_contrast_low]}>
      <Text style={[t.atoms.text_contrast_medium, a.text_center]}>
        <Trans>End of feed</Trans>
      </Text>
    </View>
  )
}
