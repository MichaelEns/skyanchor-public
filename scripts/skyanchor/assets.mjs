import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import sharp from 'sharp'

const root = process.cwd()
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const walk = dir =>
  fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(file) : [file]
  })
const anchorPath =
  'M12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM11 8v10c-4-.4-6-2.5-6-6H2c0 6 4 10 10 10s10-4 10-10h-3c0 3.5-2 5.6-6 6V8h-2Z'
const anchor = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#0c3346"/><path d="${anchorPath}" fill="#7ee4ce"/></svg>`
const art = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900"><rect width="1200" height="900" fill="#0c3346"/><circle cx="950" cy="190" r="100" fill="#7ee4ce"/><path d="M0 550Q300 350 600 550T1200 550V900H0Z" fill="#18556b"/><path d="M0 710Q300 510 600 710T1200 710V900H0Z" fill="#287c87"/><g transform="translate(430 280) scale(14)"><path d="${anchorPath}" fill="#d4fff2"/></g></svg>`
const mappings = {
  Accessibility: 'accessibility',
  Alien: 'bot',
  Apple: 'apple',
  ArrowBottom: 'arrow-down',
  ArrowBoxLeft: 'log-out',
  ArrowBoxRight: 'log-in',
  ArrowCornerDownRight: 'corner-down-right',
  ArrowLeft: 'arrow-left',
  ArrowOutOfBox: 'share',
  ArrowOutOfBoxModified: 'share',
  ArrowRight: 'arrow-right',
  ArrowRotateClockwise: 'rotate-cw',
  ArrowRotateCounterClockwise: 'rotate-ccw',
  ArrowsDiagonalIn: 'minimize-2',
  ArrowsDiagonalOut: 'maximize-2',
  ArrowShareRight: 'forward',
  ArrowTop: 'arrow-up',
  ArrowTopCircle: 'circle-arrow-up',
  ArrowTopRight: 'arrow-up-right',
  ArrowTriangleBottom: 'chevron-down',
  AspectRatio11: 'square',
  AspectRatio34: 'rectangle-vertical',
  AspectRatio43: 'rectangle-horizontal',
  At: 'at-sign',
  Atom: 'atom',
  Bars3: 'chart-no-axes-column',
  Beaker: 'beaker',
  Bell: 'bell',
  Bell2: 'bell',
  BellPlus: 'bell-plus',
  BellRinging: 'bell-ring',
  BirthdayCake: 'cake',
  Bookmark: 'bookmark',
  Bot: 'bot',
  BroomSparkle: 'brush',
  Bubble: 'message-circle',
  BubbleInfo: 'message-circle-question',
  Bubbles: 'messages-square',
  BulletList: 'list',
  CC: 'captions',
  Calendar: 'calendar',
  CalendarClock: 'calendar-clock',
  CalendarDays: 'calendar-days',
  Camera: 'camera',
  Car: 'car',
  Celebrate: 'party-popper',
  ChainLink: 'link',
  Check: 'check',
  ChevronBottom: 'chevron-down',
  ChevronLeft: 'chevron-left',
  ChevronRight: 'chevron-right',
  ChevronTop: 'chevron-up',
  Circle: 'circle',
  CircleAndSquare: 'shapes',
  CircleBanSign: 'ban',
  CircleCheck: 'circle-check',
  CircleInfo: 'info',
  CirclePlus: 'circle-plus',
  CircleQuestion: 'circle-help',
  CircleX: 'circle-x',
  Clipboard: 'clipboard',
  Clock: 'clock',
  CloseQuote: 'quote',
  Code: 'code',
  CodeBrackets: 'code',
  CodeLines: 'file-code',
  ColorPalette: 'palette',
  Contacts: 'contact',
  Crop: 'crop',
  DotGrid: 'grip',
  Download: 'download',
  Earth: 'earth',
  EditBig: 'square-pen',
  Emoji: 'smile',
  Envelope: 'mail',
  EnveopeOpen: 'mail-open',
  ExclamationCircle: 'circle-alert',
  Explosion: 'sparkles',
  Eye: 'eye',
  EyeSlash: 'eye-off',
  Filter: 'list-filter',
  FilterTimeline: 'list-filter',
  Flag: 'flag',
  Flame: 'flame',
  Flip: 'flip-horizontal',
  FloppyDisk: 'save',
  Freeze: 'snowflake',
  GameController: 'gamepad-2',
  Gif: 'image-play',
  Gift1: 'gift',
  Globe: 'globe',
  Group: 'users',
  Group3: 'users-round',
  Growth: 'trending-up',
  Haptic: 'vibrate',
  Hashtag: 'hash',
  Heart2: 'heart',
  Home: 'house',
  HomeOpen: 'house',
  Image: 'image',
  Inbox: 'inbox',
  Key: 'key-round',
  Lab: 'flask-conical',
  Language: 'languages',
  Leaf: 'leaf',
  LikeRepost: 'repeat-2',
  List: 'list',
  ListMagnifyingGlass: 'list-filter',
  ListSparkle: 'list-plus',
  Live: 'radio',
  Loader: 'loader',
  Lock: 'lock',
  Macintosh: 'monitor',
  MagnifyingGlass: 'search',
  Megaphone: 'megaphone',
  Menu: 'menu',
  Message: 'message-square',
  Moon: 'moon',
  MusicNote: 'music',
  Mute: 'volume-x',
  News2: 'newspaper',
  Newspaper: 'newspaper',
  Notification: 'bell',
  OpenQuote: 'quote',
  Page: 'file',
  PageText: 'file-text',
  PageX: 'file-x',
  PaintRoller: 'paint-roller',
  PaperPlane: 'send',
  Pause: 'pause',
  Pencil: 'pencil',
  PeopleRemove2: 'user-minus',
  Person: 'user-round',
  Phone: 'smartphone',
  Pin: 'pin',
  PinLocation: 'map-pin',
  Pizza: 'pizza',
  Play: 'play',
  Plus: 'plus',
  QrCode: 'qr-code',
  Quote: 'quote',
  RaisingHand: 'hand',
  RaisingHand4Finger: 'hand',
  Reply: 'reply',
  Repost: 'repeat-2',
  Rose: 'flower-2',
  Settings: 'settings',
  SettingsGear2: 'settings',
  SettingsSlider: 'sliders-horizontal',
  Shaka: 'hand',
  Shapes: 'shapes',
  Shield: 'shield',
  Sparkle: 'sparkles',
  Speaker: 'volume',
  SpeakerVolumeFull: 'volume-2',
  Square: 'square',
  SquareArrowTopRight: 'square-arrow-out-up-right',
  SquareBehindSquare4: 'layers',
  Star: 'star',
  StreamingLive: 'radio',
  TextSize: 'a-large-small',
  Ticket: 'ticket',
  Times: 'x',
  TimesLarge: 'x',
  TinyChevronBottom: 'chevron-down',
  TitleCase: 'case-sensitive',
  Trash: 'trash-2',
  Tree: 'tree-pine',
  Trending: 'trending-up',
  TriangleExclamation: 'triangle-alert',
  UFO: 'orbit',
  Unlock: 'lock-open',
  UserCircle: 'circle-user-round',
  VideoClip: 'video',
  Warning: 'triangle-alert',
  Window: 'panels-top-left',
  Wrench: 'wrench',
  Zap: 'zap',
  StarterPack: 'package-plus',
  StarterPackMultiPathLarge: 'package-plus',
  Verified: 'badge-check',
  VerifiedCheck: 'badge-check',
  VerifierCheck: 'shield-check',
  AppleLogo: 'smartphone',
  AndroidLogo: 'smartphone',
  Attie: 'bot',
  Leaflet: 'book-open',
  Offprint: 'book-open-text',
  Pckt: 'book-marked',
  PcktFull: 'book-marked',
  StandardSite: 'globe',
  Bell2Off: 'bell-off',
  BookmarkDelete: 'bookmark-minus',
  BubbleQuestion: 'message-circle-question',
  BubbleSmile: 'message-circle-heart',
  ChainLinkBroken: 'unlink',
  CheckThick: 'check',
  ChevronTopBottom: 'chevrons-up-down',
  DotGrid2x3: 'grip-vertical',
  DotGrid3x1: 'ellipsis',
  EmojiArc: 'smile',
  EmojiHeartEyes: 'heart',
  EmojiSad: 'frown',
  EmojiSmile: 'smile',
  EnvelopeNotification: 'mail-plus',
  EnvelopeOpen: 'mail-open',
  FlipHorizontal: 'flip-horizontal',
  FlipVertical: 'flip-vertical',
  Full: 'maximize',
  GifSquare: 'image-play',
  Github: 'github',
  HashtagWide: 'hash',
  ListPlus: 'list-plus',
  MagnifyingGlassX: 'search-x',
  MessagePlus: 'message-square-plus',
  NotificationActivitySmall: 'bell',
  NotificationFollowSmall: 'user-plus',
  NotificationLikeSmall: 'heart',
  NotificationMentionSmall: 'at-sign',
  NotificationQuoteSmall: 'quote',
  NotificationReplySmall: 'reply',
  NotificationRepostSmall: 'repeat-2',
  NotificationStarterPackSmall: 'package-plus',
  NotificationVerifiedSmall: 'badge-check',
  PaperPlaneVertical: 'send',
  PencilLine: 'pencil-line',
  PersonCheck: 'user-check',
  PersonGroup: 'users',
  PersonPlus: 'user-plus',
  PersonX: 'user-x',
  PhoneHaptic: 'vibrate',
  PinLocationFilled: 'map-pin',
  PlusLarge: 'plus',
  PlusSmall: 'plus',
  RepostRepost: 'repeat-2',
  RepostStrike: 'repeat-2',
  SettingsSliderVertical: 'sliders-vertical',
  ShieldCheck: 'shield-check',
  SquareBehindSquare: 'layers',
  Trending2: 'trending-up',
  Trending3: 'trending-up',
}
/* Service identity remains in the adjacent text; forks do not redistribute provider trademarks. */
for (const provider of [
  'BackerKit',
  'BigCartel',
  'Boosty',
  'Booth',
  'BuyMeACoffee',
  'CashApp',
  'Chuffed',
  'Crowdfundr',
  'Donorbox',
  'Etsy',
  'Fantia',
  'Fourthwall',
  'Givebutter',
  'GiveSendGo',
  'GoFundMe',
  'Gumroad',
  'Indiegogo',
  'Inprint',
  'ItchIo',
  'JustGiving',
  'Kickstarter',
  'KoFi',
  'Liberapay',
  'OpenCollective',
  'Patreon',
  'PayPal',
  'PixivFanbox',
  'Redbubble',
  'Skeb',
  'Stripe',
  'SubscribeStar',
  'Substack',
  'Throne',
  'Venmo',
  'Vgen',
  'Zeffy',
])
  mappings[provider] = 'hand-coins'
const originalsFile = path.join(
  root,
  'scripts',
  'skyanchor',
  'original-assets.json',
)
const carved = [
  path.join('assets', 'icons', 'ui'),
  path.join('assets', 'icons', 'brands'),
  path.join('assets', 'icons', 'community'),
  path.join('assets', 'icons', 'custom'),
  path.join('assets', 'icons', 'tmp'),
  path.join('assets', 'images'),
  path.join('assets', 'illustrations'),
  path.join('assets', 'app-icons'),
  path.join('assets', 'splash'),
]
const individual = [
  'favicon.png',
  'logo.png',
  'default-avatar.png',
  'icon-android-foreground.png',
  'icon-android-monochrome.png',
  'icon-android-notification.png',
  'kawaii.png',
  'kawaii_smol.png',
]
const sourceFiles = carved
  .flatMap(dir => (fs.existsSync(dir) ? walk(dir) : []))
  .concat(individual.map(file => path.join('assets', file)))
  .filter(file => fs.existsSync(file) && /\.(png|webp|jpe?g|svg)$/i.test(file))
if (!fs.existsSync(originalsFile)) {
  const originals = sourceFiles.map(file => ({
    file,
    sha256: hash(fs.readFileSync(file)),
    fragments: file.endsWith('.svg')
      ? [...fs.readFileSync(file, 'utf8').matchAll(/\bd="([^"]{80,})"/g)].map(
          match => match[1].slice(0, 100),
        )
      : [],
  }))
  for (const file of walk(path.join('src', 'view', 'icons')).filter(file =>
    file.endsWith('.tsx'),
  )) {
    const original = execFileSync(
      'git',
      [
        'show',
        `96262a98f6eb751f50a25625ef4d2a8ac5ede626:${file.replaceAll('\\', '/')}`,
      ],
      {encoding: 'utf8'},
    )
    originals.push({
      file,
      sha256: hash(original),
      fragments: [...original.matchAll(/\bd="([^"]{80,})"/g)].map(match =>
        match[1].slice(0, 100),
      ),
    })
  }
  fs.writeFileSync(originalsFile, JSON.stringify(originals, null, 2) + '\n')
}
const originalAssets = JSON.parse(fs.readFileSync(originalsFile, 'utf8'))
for (const file of [
  ...walk(path.join('src', 'view', 'icons')).filter(file =>
    file.endsWith('.tsx'),
  ),
  path.join('src', 'components', 'icons', 'TEMPLATE.tsx'),
]) {
  const original = execFileSync(
    'git',
    [
      'show',
      `96262a98f6eb751f50a25625ef4d2a8ac5ede626:${file.replaceAll('\\', '/')}`,
    ],
    {encoding: 'utf8'},
  )
  const record = {
    file,
    sha256: hash(original),
    fragments: [...original.matchAll(/\bd="([^"]{80,})"/g)].map(match =>
      match[1].slice(0, 100),
    ),
  }
  const index = originalAssets.findIndex(asset => asset.file === file)
  if (index < 0) originalAssets.push(record)
  else originalAssets[index] = record
}
fs.writeFileSync(originalsFile, JSON.stringify(originalAssets, null, 2) + '\n')

function resolve(name) {
  const base = name.split('_')[0]
  if (['Logo', 'Mark', 'Newskie'].includes(base))
    return {name: 'skyanchor-original', d: anchorPath}
  const icon = mappings[base]
  if (!icon) throw new Error(`Explicit Lucide mapping required: ${name}`)
  const svg = fs.readFileSync(
    path.join('node_modules', 'lucide-static', 'icons', icon + '.svg'),
    'utf8',
  )
  const parts = [
    ...svg.matchAll(/<(path|circle|rect|line|polyline|polygon)\b([^>]*)\/?>/g),
  ].map(([, tag, attrs]) => {
    const a = Object.fromEntries(
      [...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]),
    )
    if (tag === 'path') return a.d
    if (tag === 'circle')
      return `M${+a.cx - +a.r} ${a.cy}a${a.r} ${a.r} 0 1 0 ${+a.r * 2} 0a${a.r} ${a.r} 0 1 0 ${-a.r * 2} 0`
    if (tag === 'rect')
      return `M${a.x} ${a.y}h${a.width}v${a.height}h${-a.width}Z`
    if (tag === 'line') return `M${a.x1} ${a.y1}L${a.x2} ${a.y2}`
    return (
      'M' +
      a.points.trim().replaceAll(' ', 'L') +
      (tag === 'polygon' ? 'Z' : '')
    )
  })
  return {name: icon, paths: parts}
}
const inventory = []
for (const file of walk(path.join('src', 'components', 'icons')).filter(file =>
  file.endsWith('.tsx'),
)) {
  if (
    [
      'TEMPLATE.tsx',
      'common.tsx',
      'nano.tsx',
      'nano.web.tsx',
      'Logo.tsx',
    ].includes(path.basename(file))
  )
    continue
  const text = fs.readFileSync(file, 'utf8')
  const exports = [...text.matchAll(/export (?:const|function) (\w+)/g)].map(
    match => match[1],
  )
  if (!exports.length) throw new Error(`No icon exports in ${file}`)
  const factories = new Set()
  const lines = exports.map(name => {
    if (name === 'Full')
      return "export {Logotype as Full} from '#/view/icons/Logotype'"
    const icon = resolve(name)
    inventory.push({file, export: name, source: icon.name})
    if (icon.name === 'skyanchor-original') {
      factories.add('createSinglePathSVG')
      return `export const ${name} = createSinglePathSVG({path: ${JSON.stringify(icon.d)}, viewBox: '0 0 24 24'})`
    }
    factories.add('createSVG')
    const elements = icon.paths.map(d => ({
      type: 'path',
      d,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }))
    return `export const ${name} = createSVG({elements: ${JSON.stringify(elements)}, viewBox: '0 0 24 24'})\n${name}.svgStrokeWidth = 2`
  })
  fs.writeFileSync(
    file,
    `// Generated by skyanchor:assets; original SkyAnchor or Lucide ISC paths, no Central glyphs.\n${factories.size ? `import {${[...factories].join(', ')}} from '#/components/icons/TEMPLATE'\n` : ''}\n${lines.join('\n\n')}\n`,
  )
}
for (const file of sourceFiles) {
  if (file.endsWith('.svg')) {
    const icon = resolve(path.basename(file, '.svg'))
    fs.writeFileSync(
      file,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${(icon.paths ?? [icon.d]).map(d => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>\n`,
    )
  } else {
    const image = /images|illustrations/.test(file) ? art : anchor
    await sharp(Buffer.from(image))
      .resize(/images|illustrations/.test(file) ? 1200 : 512)
      .toFile(file)
  }
}
fs.mkdirSync(path.join('assets', 'skyanchor'), {recursive: true})
fs.writeFileSync(path.join('assets', 'skyanchor', 'anchor.svg'), anchor + '\n')
fs.writeFileSync(path.join('assets', 'skyanchor', 'landing.svg'), art + '\n')
await sharp(Buffer.from(anchor))
  .resize(192)
  .png()
  .toFile(path.join('public', 'skyanchor-192.png'))
await sharp(Buffer.from(anchor))
  .resize(512)
  .png()
  .toFile(path.join('public', 'skyanchor-512.png'))
fs.writeFileSync(
  path.join('scripts', 'skyanchor', 'asset-mappings.json'),
  JSON.stringify(inventory, null, 2) + '\n',
)
console.log(
  `Replaced ${sourceFiles.length} carved-out assets and ${inventory.length} icon exports`,
)
