import {
  forwardRef,
  type ForwardRefExoticComponent,
  type RefAttributes,
} from 'react'
import Svg, {Circle, Path, Rect} from 'react-native-svg'

import {type Props, useCommonSVGProps} from '#/components/icons/common'
import {type NanoGlyphName} from '#/components/icons/glyphMaps'
import {withNanoGlyph} from '#/components/icons/nano'

export type IconWithSvgMeta = ForwardRefExoticComponent<
  Props & RefAttributes<Svg>
> & {
  svgPaths: string[]
  svgViewBox: string
  svgStrokeWidth: number
}

export const IconTemplate_Stroke2_Corner0_Rounded = createSinglePathSVG({
  path: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0 M2 12h20 M12 2a17 17 0 0 0 0 20a17 17 0 0 0 0-20',
  viewBox: '0 0 24 24',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
})

export function createSinglePathSVG({
  path,
  viewBox,
  strokeWidth = 0,
  strokeLinecap = 'butt',
  strokeLinejoin = 'miter',
  glyph,
}: {
  path: string
  viewBox?: string
  strokeWidth?: number
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'miter' | 'round' | 'bevel'
  /**
   * The icon's glyph in the icon fonts, set by codegen when the glyph renders
   * the same as this SVG. See `withNanoGlyph`.
   */
  glyph?: NanoGlyphName
}) {
  const Icon = forwardRef<Svg, Props>(function LogoImpl(props, ref) {
    const {fill, size, style, gradient, ...rest} = useCommonSVGProps(props)

    const hasStroke = strokeWidth > 0

    return (
      <Svg
        fill="none"
        {...rest}
        ref={ref}
        viewBox={viewBox ?? '0 0 24 24'}
        width={size}
        height={size}
        style={[style]}>
        {gradient}
        <Path
          fill={hasStroke ? 'none' : fill}
          stroke={hasStroke ? fill : 'none'}
          strokeWidth={strokeWidth}
          strokeLinecap={strokeLinecap}
          strokeLinejoin={strokeLinejoin}
          fillRule="evenodd"
          clipRule="evenodd"
          d={path}
        />
      </Svg>
    )
  }) as IconWithSvgMeta
  Icon.svgPaths = [path]
  Icon.svgViewBox = viewBox || '0 0 24 24'
  Icon.svgStrokeWidth = strokeWidth
  return withNanoGlyph(Icon, {glyph, layered: false})
}

/**
 * Prefer `createSinglePathSVG` - do a boolean union in Figma prior to exporting, unless you have a specific reason.
 */
export function createMultiPathSVG({
  paths,
  viewBox,
}: {
  paths: string[]
  viewBox?: string
}) {
  const Icon = forwardRef<Svg, Props>(function LogoImpl(props, ref) {
    const {fill, size, style, gradient, ...rest} = useCommonSVGProps(props)

    return (
      <Svg
        fill="none"
        {...rest}
        ref={ref}
        viewBox={viewBox ?? '0 0 24 24'}
        width={size}
        height={size}
        style={[style]}>
        {gradient}
        {paths.map((path, i) => (
          <Path
            key={i}
            fill={fill}
            fillRule="evenodd"
            clipRule="evenodd"
            d={path}
          />
        ))}
      </Svg>
    )
  }) as IconWithSvgMeta
  Icon.svgPaths = paths
  Icon.svgViewBox = viewBox || '0 0 24 24'
  Icon.svgStrokeWidth = 0
  return Icon
}

type GeneratedSVGElement = {
  type: 'circle' | 'path' | 'rect'
  fill?: string
  stroke?: string
  strokeWidth?: number
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'bevel' | 'miter' | 'round'
} & (
  | {
      type: 'path'
      d: string
      fillRule?: 'evenodd' | 'nonzero'
      clipRule?: 'evenodd' | 'nonzero'
    }
  | {type: 'circle'; cx: number; cy: number; r: number}
  | {
      type: 'rect'
      x: number
      y: number
      width: number
      height: number
      rx?: number
      ry?: number
    }
)

export function createSVG({
  elements,
  viewBox,
  glyph,
}: {
  elements: GeneratedSVGElement[]
  viewBox: string
  /** See `createSinglePathSVG`. */
  glyph?: NanoGlyphName
}) {
  const Icon = forwardRef<Svg, Props>(function LogoImpl(props, ref) {
    const {fill, size, style, gradient, ...rest} = useCommonSVGProps(props)
    const paint = (value: string | undefined) =>
      value === 'currentColor' ? fill : value

    return (
      <Svg
        fill="none"
        {...rest}
        ref={ref}
        viewBox={viewBox}
        width={size}
        height={size}
        style={[style]}>
        {gradient}
        {elements.map((element, i) => {
          const common = {
            fill: paint(element.fill),
            stroke: paint(element.stroke),
            strokeWidth: element.strokeWidth,
            strokeLinecap: element.strokeLinecap,
            strokeLinejoin: element.strokeLinejoin,
          }
          if (element.type === 'path') {
            return (
              <Path
                {...common}
                key={i}
                d={element.d}
                fillRule={element.fillRule}
                clipRule={element.clipRule}
              />
            )
          }
          if (element.type === 'circle') {
            return (
              <Circle
                {...common}
                key={i}
                cx={element.cx}
                cy={element.cy}
                r={element.r}
              />
            )
          }
          return (
            <Rect
              {...common}
              key={i}
              x={element.x}
              y={element.y}
              width={element.width}
              height={element.height}
              rx={element.rx}
              ry={element.ry}
            />
          )
        })}
      </Svg>
    )
  }) as IconWithSvgMeta
  Icon.svgPaths = elements.flatMap(element =>
    element.type === 'path' ? [element.d] : [],
  )
  Icon.svgViewBox = viewBox
  Icon.svgStrokeWidth = 0
  return withNanoGlyph(Icon, {glyph, layered: true})
}
