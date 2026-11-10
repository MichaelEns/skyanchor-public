import Svg, {type PathProps, type SvgProps, Text} from 'react-native-svg'

import {useTheme} from '#/alf'

export function Logotype({
  fill,
  textFill,
  ...rest
}: {fill?: PathProps['fill']; textFill?: PathProps['fill']} & SvgProps) {
  const t = useTheme()
  const size = Number(rest.width || 100)
  return (
    <Svg {...rest} viewBox="0 0 140 28" width={size} height={size / 5}>
      <Text
        x={0}
        y={22}
        fill={textFill || fill || t.atoms.text.color}
        fontFamily="InterVariable, sans-serif"
        fontWeight="700"
        fontSize={24}>
        SkyAnchor
      </Text>
    </Svg>
  )
}
