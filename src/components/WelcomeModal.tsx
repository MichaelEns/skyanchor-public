import {useEffect, useEffectEvent, useState} from 'react'
import {Pressable, View} from 'react-native'
import {ImageBackground} from 'expo-image'
import {Trans, useLingui} from '@lingui/react/macro'
import * as FocusGuards from '@radix-ui/react-focus-guards'
import * as FocusScope from '@radix-ui/react-focus-scope'

import {useLoggedOutViewControls} from '#/state/shell/logged-out'
import {Logo} from '#/view/icons/Logo'
import {atoms as a, flatten, useBreakpoints, useTheme, web} from '#/alf'
import {Button, ButtonText} from '#/components/Button'
import {type WelcomeModalControl} from '#/components/hooks/useWelcomeModal.shared'
import {TimesLarge_Stroke2_Corner0_Rounded as XIcon} from '#/components/icons/Times'
import {Text} from '#/components/Typography'
import {useAnalytics} from '#/analytics'

const welcomeModalBg = require('../../assets/images/welcome-modal-bg.jpg')

interface WelcomeModalProps {
  control: WelcomeModalControl
}

export function WelcomeModal({control}: WelcomeModalProps) {
  const {t: l} = useLingui()
  const t = useTheme()
  const ax = useAnalytics()
  const {requestSwitchToAccount} = useLoggedOutViewControls()
  const {gtMobile} = useBreakpoints()
  const [isExiting, setIsExiting] = useState(false)
  const [signInLinkHovered, setSignInLinkHovered] = useState(false)

  const fadeOutAndClose = (callback?: () => void) => {
    setIsExiting(true)
    setTimeout(() => {
      control.close()
      if (callback) callback()
    }, 150)
  }

  const onPresented = useEffectEvent(() => {
    ax.metric('welcomeModal:presented', {})
  })

  useEffect(() => {
    if (control.isOpen) {
      onPresented()
    }
  }, [control.isOpen])

  const onPressCreateAccount = () => {
    ax.metric('welcomeModal:signupClicked', {})
    control.close()
    requestSwitchToAccount({requestedAccount: 'new'})
  }

  const onPressExplore = () => {
    ax.metric('welcomeModal:exploreClicked', {})
    fadeOutAndClose()
  }

  const onPressSignIn = () => {
    ax.metric('welcomeModal:signinClicked', {})
    control.close()
    requestSwitchToAccount({requestedAccount: 'existing'})
  }

  FocusGuards.useFocusGuards()

  return (
    <View
      role="dialog"
      testID="welcomeModal"
      accessibilityLabel={l`Welcome to SkyAnchor`}
      accessibilityHint={l`Create an account, explore, or sign in`}
      aria-modal
      style={[
        a.fixed,
        a.inset_0,
        a.justify_center,
        a.align_center,
        {zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.2)'},
        web({backdropFilter: 'blur(15px)'}),
        isExiting ? a.fade_out : a.fade_in,
      ]}>
      <FocusScope.FocusScope asChild loop trapped>
        <View
          style={flatten([
            {
              maxWidth: 800,
              maxHeight: 600,
              width: '90%',
              height: '90%',
              backgroundColor: t.palette.contrast_0,
            },
            a.rounded_lg,
            a.overflow_hidden,
            a.zoom_in,
          ])}>
          <ImageBackground
            source={welcomeModalBg}
            style={[a.flex_1, a.justify_center]}
            contentFit="cover">
            <View
              testID="welcomeTextSurface"
              style={[
                a.gap_lg,
                a.align_center,
                a.p_lg,
                a.m_lg,
                a.rounded_lg,
                t.atoms.bg,
              ]}>
              <View
                style={[
                  a.flex_row,
                  a.align_center,
                  a.justify_center,
                  a.w_full,
                  a.p_0,
                ]}>
                <View style={[a.flex_row, a.align_center, a.gap_xs]}>
                  <Logo
                    allowVariants={false}
                    width={26}
                    fill={t.palette.contrast_900}
                  />
                  <Text
                    style={[
                      a.text_2xl,
                      a.font_semi_bold,
                      a.user_select_none,
                      t.atoms.text,
                      {letterSpacing: -0.5},
                    ]}>
                    SkyAnchor
                  </Text>
                </View>
              </View>
              <View style={[a.gap_sm, a.align_center, a.py_lg]}>
                <Text
                  style={[
                    gtMobile ? a.text_4xl : a.text_3xl,
                    a.font_semi_bold,
                    a.text_center,
                    t.atoms.text,
                    web({
                      lineHeight: 1.2,
                      letterSpacing: -0.5,
                    }),
                  ]}>
                  <Trans>Real people.</Trans>
                  {'\n'}
                  <Trans>Real conversations.</Trans>
                  {'\n'}
                  <Trans>Social media you control.</Trans>
                </Text>
              </View>
              <View style={[a.gap_md, a.align_center]}>
                <View>
                  <Button
                    onPress={onPressCreateAccount}
                    label={l`Create account`}
                    size="large"
                    color="secondary_inverted"
                    style={{
                      width: 200,
                    }}>
                    <ButtonText>
                      <Trans>Create account</Trans>
                    </ButtonText>
                  </Button>
                  <Button
                    onPress={onPressExplore}
                    label={l`Explore the app`}
                    size="large"
                    color="primary"
                    variant="ghost"
                    style={[a.bg_transparent, {width: 200}]}
                    hoverStyle={[a.bg_transparent]}>
                    {({hovered}) => (
                      <ButtonText
                        style={[hovered && [a.underline], t.atoms.text]}>
                        <Trans>Explore the app</Trans>
                      </ButtonText>
                    )}
                  </Button>
                </View>
                <View style={[a.align_center, {minWidth: 200}]}>
                  <Text
                    style={[
                      a.text_md,
                      a.text_center,
                      t.atoms.text,
                      {lineHeight: 24},
                    ]}>
                    <Trans>Already have an account?</Trans>{' '}
                    <Pressable
                      onPress={onPressSignIn}
                      onPointerEnter={() => setSignInLinkHovered(true)}
                      onPointerLeave={() => setSignInLinkHovered(false)}
                      accessibilityRole="button"
                      accessibilityLabel={l`Sign in`}
                      accessibilityHint="">
                      <Text
                        style={[
                          a.font_medium,
                          {
                            fontSize: undefined,
                          },
                          t.atoms.text,
                          a.underline,
                          signInLinkHovered && a.underline,
                        ]}>
                        <Trans>Sign in</Trans>
                      </Text>
                    </Pressable>
                  </Text>
                </View>
              </View>
            </View>
            <Button
              label={l`Close welcome modal`}
              style={[
                a.absolute,
                {
                  top: 8,
                  right: 8,
                },
                t.atoms.bg,
              ]}
              hoverStyle={[t.atoms.bg_contrast_25]}
              onPress={() => {
                ax.metric('welcomeModal:dismissed', {})
                fadeOutAndClose()
              }}
              color="secondary"
              size="small"
              variant="ghost"
              shape="round">
              <XIcon
                size="md"
                style={{
                  color: t.palette.contrast_900,
                }}
              />
            </Button>
          </ImageBackground>
        </View>
      </FocusScope.FocusScope>
    </View>
  )
}
