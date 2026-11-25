import * as React from 'react';
import {
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignJustify,
  AlignStartHorizontal,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Blend,
  Bold,
  Bot,
  Brush,
  Calendar,
  CalendarClock,
  CaseSensitive,
  ChartColumn,
  ChartLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Clipboard,
  ClipboardType,
  Clock,
  Copy,
  DecimalsArrowLeft,
  DecimalsArrowRight,
  Divide,
  DollarSign,
  Ellipsis,
  Eraser,
  Eye,
  EyeOff,
  File,
  FilePlus,
  FileUp,
  Files,
  Folder,
  Funnel,
  GitPullRequest,
  Globe,
  GripVertical,
  Group,
  Hash,
  Heading1,
  Highlighter,
  History,
  House,
  Image,
  Info,
  Italic,
  Keyboard,
  LayoutDashboard,
  LayoutTemplate,
  LetterText,
  Link,
  List,
  ListChecks,
  ListFilter,
  LoaderCircle,
  Lock,
  LogOut,
  Maximize2,
  Menu,
  MessageSquare,
  Minimize2,
  Minus,
  Monitor,
  Moon,
  MoveHorizontal,
  MoveVertical,
  PaintBucket,
  Palette,
  Pencil,
  Percent,
  Pin,
  PinOff,
  Play,
  Plus,
  Reply,
  RotateCcw,
  RotateCw,
  Scale,
  Scan,
  Scissors,
  Search,
  Send,
  Settings,
  Shuffle,
  Sigma,
  SlidersHorizontal,
  Smartphone,
  Square,
  SquareArrowOutUpRight,
  SquareCheck,
  SquareChevronDown,
  SquareFunction,
  Strikethrough,
  Sun,
  Superscript,
  SwatchBook,
  Table,
  TableCellsMerge,
  TableCellsSplit,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Ticket,
  Timer,
  Trash2,
  TriangleAlert,
  Type,
  Underline,
  Ungroup,
  Unplug,
  Upload,
  User,
  WandSparkles,
  WrapText,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';
import { useDensity } from './theme.tsx';

type DrawnIcon = React.ForwardRefExoticComponent<LucideProps & React.RefAttributes<SVGSVGElement>>;

const lines = (d: string, dashed?: string): DrawnIcon =>
  React.forwardRef<SVGSVGElement, LucideProps>(function BorderIcon({ size = 24, strokeWidth = 2, absoluteStrokeWidth: _absolute, color = 'currentColor', ...rest }, ref) {
    return (
      <svg ref={ref} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...rest}>
        {dashed === undefined ? null : <path d={dashed} strokeDasharray="1 3" opacity={0.6} />}
        {d === '' ? null : <path d={d} />}
      </svg>
    );
  });

const OUTER = 'M4 4h16v16H4z';
const ALL_DASHED = 'M4 4h16v16H4zM12 4v16M4 12h16';

const BorderAll = lines('M4 4h16v16H4zM12 4v16M4 12h16');
const BorderOuter = lines(OUTER, 'M12 4v16M4 12h16');
const BorderInner = lines('M12 4v16M4 12h16', OUTER);
const BorderInnerHorizontal = lines('M4 12h16', 'M4 4h16v16H4zM12 4v16');
const BorderInnerVertical = lines('M12 4v16', 'M4 4h16v16H4zM4 12h16');
const BorderTop = lines('M4 4h16', 'M20 4v16H4V4M12 4v16M4 12h16');
const BorderBottom = lines('M4 20h16', 'M4 20V4h16v16M12 4v16M4 12h16');
const BorderLeft = lines('M4 4v16', 'M4 4h16v16H4M12 4v16M4 12h16');
const BorderRight = lines('M20 4v16', 'M20 4H4v16h16M12 4v16M4 12h16');
const BorderClear = lines('', ALL_DASHED);
const ColumnDelete = lines('M9 4h6v16H9zM17 9l4 4m0-4-4 4', 'M3 4h3M3 20h3');
const RowDelete = lines('M4 9h16v6H4zM10 17l4 4m0-4-4 4', 'M4 3v3M20 3v3');

const ICONS = {
  Add: Plus,
  Agent: Bot,
  AlignCenter: AlignCenterHorizontal,
  AlignEnd: AlignEndHorizontal,
  AlignStart: AlignStartHorizontal,
  ArrowClockwise: RotateCw,
  ArrowCounterClockwise: RotateCcw,
  ArrowDown,
  ArrowLeft,
  ArrowOutSquare: SquareArrowOutUpRight,
  ArrowRight,
  ArrowUp,
  ArrowsIn: Minimize2,
  Automatic: WandSparkles,
  BorderAll,
  BorderBottom,
  BorderClear,
  BorderInner,
  BorderInnerHorizontal,
  BorderInnerVertical,
  BorderLeft,
  BorderOuter,
  BorderRight,
  BorderTop,
  Brush,
  Calendar,
  CalendarClock,
  CaretDown: ChevronDown,
  CaretDownSmall: ChevronDown,
  CaretLeft: ChevronLeft,
  CaretRight: ChevronRight,
  CaretUp: ChevronUp,
  Chart: ChartColumn,
  ChartLine,
  Chat: MessageSquare,
  Check,
  CheckCircleFilled: CircleCheck,
  CheckSquare: SquareCheck,
  Checklist: ListChecks,
  Clipboard,
  Clock,
  Collapse: ChevronsDownUp,
  ColorScale: Blend,
  ColumnWidth: MoveHorizontal,
  Comment: MessageSquare,
  CommentFilled: MessageSquare,
  Compact: AlignJustify,
  Computer: Monitor,
  ConditionalFormat: SwatchBook,
  Copy,
  DecimalsFewer: DecimalsArrowLeft,
  DecimalsMore: DecimalsArrowRight,
  Disconnect: Unplug,
  DollarSign,
  DotsHorizontal: Ellipsis,
  DotsVertical: Ellipsis,
  Dropdown: SquareChevronDown,
  Edit: Pencil,
  Divide,
  Eraser,
  Expand: ChevronsUpDown,
  Exponent: Superscript,
  Eye,
  EyeSlash: EyeOff,
  File,
  FileAdd: FilePlus,
  FileUpload: FileUp,
  Files,
  Filter: Funnel,
  FilterLines: ListFilter,
  Folder,
  Function: SquareFunction,
  GitPullRequest,
  Globe,
  Group,
  Heading1,
  History,
  Home: House,
  Image,
  Info,
  Keyboard,
  Layout: LayoutDashboard,
  Link,
  ListBullet: List,
  Lock,
  Logout: LogOut,
  Maximize: Maximize2,
  Menu,
  Minus,
  Moon,
  Numbers: Hash,
  PaintBucket,
  Palette,
  PaperPlane: Send,
  PasteValues: ClipboardType,
  PercentSign: Percent,
  Phone: Smartphone,
  Pin,
  PinSlash: PinOff,
  PlainText: LetterText,
  PlayFilled: Play,
  Reorder: GripVertical,
  Reply,
  RowHeight: MoveVertical,
  Scale,
  Scissors,
  Search,
  Settings,
  Shuffle,
  Sigma,
  Sliders: SlidersHorizontal,
  Sort: ArrowUpDown,
  Spinner: LoaderCircle,
  Stop: Square,
  StopFilled: Square,
  Strikethrough,
  Sun,
  Table,
  TableCellSplit: TableCellsSplit,
  TableCellsMerge,
  TableColumnDelete: ColumnDelete,
  TableColumnInsertLeft: BetweenVerticalStart,
  TableColumnInsertRight: BetweenVerticalEnd,
  TableRowDelete: RowDelete,
  TableRowInsertAbove: BetweenHorizontalStart,
  TableRowInsertBelow: BetweenHorizontalEnd,
  Templates: LayoutTemplate,
  TextAa: CaseSensitive,
  TextAlignCenter,
  TextAlignLeft: TextAlignStart,
  TextAlignRight: TextAlignEnd,
  TextBold: Bold,
  TextHighlight: Highlighter,
  TextItalics: Italic,
  TextT: Type,
  TextUnderline: Underline,
  TextWrap: WrapText,
  Ticket,
  Timer,
  Trash: Trash2,
  Ungroup,
  Upload,
  User,
  Warning: TriangleAlert,
  WarningCircle: CircleAlert,
  WarningCircleFilled: CircleAlert,
  WarningFilled: TriangleAlert,
  X,
  ZoomFit: Scan,
  ZoomIn,
  ZoomOut,
} satisfies Record<string, LucideIcon | DrawnIcon>;

export type IconName = keyof typeof ICONS;

/** Names drawn solid rather than as an outline. */
const SOLID_NAMES: ReadonlySet<IconName> = new Set<IconName>(['CommentFilled', 'PlayFilled', 'StopFilled']);

/** Names that point along the line of text, so they flip in right-to-left text. */
const MIRRORED_NAMES: ReadonlySet<IconName> = new Set<IconName>([
  'ArrowLeft',
  'ArrowOutSquare',
  'ArrowRight',
  'CaretLeft',
  'CaretRight',
  'Logout',
  'PaperPlane',
  'Reply',
  'TextWrap',
]);

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
export type IconSizeChoice = IconSize | 'auto' | 'auto-sm' | 'auto-lg';

const ICON_SIZES: readonly IconSize[] = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'];

interface IconMetrics {
  px: number;
  stroke: number;
  strongStroke: number;
}

export const ICON_METRICS: Readonly<Record<IconSize, IconMetrics>> = {
  xs: { px: 12, stroke: 1, strongStroke: 1.25 },
  sm: { px: 16, stroke: 1.25, strongStroke: 1.5625 },
  md: { px: 20, stroke: 1.25, strongStroke: 1.5625 },
  lg: { px: 24, stroke: 1.5, strongStroke: 1.875 },
  xl: { px: 28, stroke: 1.6667, strongStroke: 2 },
  xxl: { px: 32, stroke: 1.875, strongStroke: 2.25 },
};

export function isIconName(name: unknown): name is IconName {
  return typeof name === 'string' && Object.hasOwn(ICONS, name);
}

export const hasIconGlyph = isIconName;

export function resolveFilledIconName(name: IconName): IconName {
  const filled = `${name}Filled`;
  return isIconName(filled) ? filled : name;
}

export function resolveIconSize(size: IconSizeChoice, densityDefault: IconSize): IconSize {
  if (size === 'auto') return densityDefault;
  if (size === 'auto-sm' || size === 'auto-lg') return ICON_SIZES[ICON_SIZES.indexOf(densityDefault) + (size === 'auto-lg' ? 1 : -1)] ?? densityDefault;
  return size;
}

export function useDefaultIconSize(): IconSize {
  return useDensity() === 'comfortable' ? 'md' : 'sm';
}

export function useIconSize(size: IconSizeChoice = 'md'): IconSize {
  return resolveIconSize(size, useDefaultIconSize());
}

function nearestIconSize(px: number): IconSize {
  let nearest: IconSize = 'xs';
  let distance = Infinity;
  for (const size of ICON_SIZES) {
    const gap = Math.abs(ICON_METRICS[size].px - px);
    if (gap <= distance) {
      distance = gap;
      nearest = size;
    }
  }
  return nearest;
}

/** An icon drawn from path data, for marks the icon set has no name for. */
export interface CustomIcon {
  /** What the drawing is, as its callers call it; the icon neither draws nor announces it. */
  name?: string;
  viewBox: number;
  paths: ReadonlyArray<string | { d: string; strokeWidth: number }>;
}

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'name' | 'rotate' | 'ref'> {
  name?: IconName;
  customIcon?: CustomIcon;
  size?: IconSizeChoice;
  /** Pixel size, when none of the named sizes fits. */
  customSize?: number;
  bold?: boolean;
  /** Degrees to turn the icon by; mirrored in right-to-left text. */
  rotate?: number;
  /** Accessible name; without one the icon is hidden from assistive technology. */
  alt?: string;
  touch?: boolean;
}

export const Icon = React.forwardRef<SVGSVGElement, IconProps>(function Icon(
  { name, customIcon, size, customSize, bold = false, rotate, alt, touch: _touch, className, style, ...rest },
  ref,
) {
  const densityDefault = useDefaultIconSize();
  const sizeName = customSize === undefined ? resolveIconSize(size ?? 'md', densityDefault) : nearestIconSize(customSize);
  const px = customSize ?? ICON_METRICS[sizeName].px;
  const metrics = ICON_METRICS[sizeName];
  const isAuto = size === 'auto' || size === 'auto-sm' || size === 'auto-lg';
  const stroke = bold && !isAuto ? metrics.strongStroke : metrics.stroke;
  const turned = rotate === undefined || rotate === 0 ? undefined : rotate;
  const shared = {
    'data-ui': 'Icon',
    'data-ui-rotate': turned === undefined ? undefined : '',
    'data-ui-mirror': name !== undefined && MIRRORED_NAMES.has(name) ? '' : undefined,
    className,
    style: {
      flexShrink: 0,
      width: '1em',
      height: '1em',
      fontSize: `${px}px`,
      ...(turned === undefined ? null : ({ '--ui-icon-rotate': `${turned}deg` } as React.CSSProperties)),
      ...style,
    },
    role: rest.role ?? (alt ? 'img' : undefined),
    'aria-hidden': rest['aria-hidden'] ?? (alt ? undefined : true),
    'aria-label': rest['aria-label'] ?? (alt || undefined),
  } as const;
  if (customIcon !== undefined) {
    return (
      <svg
        ref={ref}
        viewBox={`0 0 ${customIcon.viewBox} ${customIcon.viewBox}`}
        fill="currentColor"
        fillRule="evenodd"
        stroke="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        xmlns="http://www.w3.org/2000/svg"
        {...rest}
        {...shared}
      >
        {customIcon.paths.map((path, index) =>
          typeof path === 'string' ? (
            <path key={index} d={path} />
          ) : (
            <path key={index} d={path.d} fill="none" stroke="currentColor" strokeWidth={path.strokeWidth} vectorEffect="non-scaling-stroke" />
          ),
        )}
      </svg>
    );
  }
  const Drawn = name === undefined ? undefined : (ICONS[name] as LucideIcon | DrawnIcon | undefined);
  if (Drawn === undefined) return null;
  const solid = name !== undefined && SOLID_NAMES.has(name);
  return (
    <Drawn
      ref={ref}
      size={px}
      strokeWidth={(stroke * 24) / px}
      {...(solid ? { fill: 'currentColor' } : null)}
      {...(rest as LucideProps)}
      {...shared}
    />
  );
});

export const LEADING_ICON_CLASS_NAME = 'flex size-icon shrink-0 items-center justify-center -my-[max(0px,calc((var(--ui-icon)_-_1lh)_/_2))]';
export const LEADING_ICON_FIRST_LINE_CLASS_NAME = 'flex h-[1lh] w-icon shrink-0 items-center justify-center self-start';

export interface LeadingIconProps {
  /** An icon name, or an element to show in its place. */
  icon: IconName | React.ReactNode;
  /** Lines the icon up with the first line of wrapping text rather than the middle. */
  firstLine?: boolean;
}

/** An icon sized and aligned to sit before a line of text. */
export function LeadingIcon({ icon, firstLine = false }: LeadingIconProps): React.ReactElement {
  return (
    <span className={firstLine ? LEADING_ICON_FIRST_LINE_CLASS_NAME : LEADING_ICON_CLASS_NAME}>
      {isIconName(icon) ? <Icon name={icon} size="auto" /> : icon}
    </span>
  );
}
