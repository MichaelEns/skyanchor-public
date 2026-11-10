import {forwardRef} from 'react'
import {type TextProps} from 'react-native'
import Svg, {Path, type PathProps, type SvgProps} from 'react-native-svg'

import {flatten, useTheme} from '#/alf'

export const ANCHOR_PATH =
  'M12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM11 8v10c-4-.4-6-2.5-6-6H2c0 6 4 10 10 10s10-4 10-10h-3c0 3.5-2 5.6-6 6V8h-2Z'

export const Logo = forwardRef<
  Svg,
  {
    allowVariants?: boolean
    fill?: PathProps['fill']
    style?: TextProps['style']
  } & Omit<SvgProps, 'style'>
>(function LogoImpl(props, ref) {
  const t = useTheme()
  const {allowVariants: _allowVariants, fill, style, ...rest} = props
  const styles = flatten(style)
  const size = Number(rest.width || 32)
  return (
    <Svg
      {...rest}
      ref={ref}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={styles}
      accessibilityLabel="SkyAnchor"
      accessibilityHint="SkyAnchor logo">
      <Path
        d={ANCHOR_PATH}
        fill={
          fill === 'sky'
            ? '#287c87'
            : fill || styles?.color || t.palette.primary_500
        }
      />
    </Svg>
  )
})
