/** A box on the screen, by its edges in pixels. */
export interface NoticeBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** What decides whether the stack of notices sits at the foot of the page rather than the top. */
export interface NoticesAtFootQuestion {
  isAtFoot: boolean;
  /** How many notices are up, the front one and those under it. */
  howManyUp: number;
  isAnyLeft: boolean;
  isFrontNew: boolean;
  /** Where the stack is when at the top. */
  spot: NoticeBox;
  spotAtFoot: NoticeBox;
  notToCover: NoticeBox[];
  betterNotCovered: NoticeBox[];
}
/** The room at the foot of the window that the stack of notices fits in. */
export interface NoticeRoomAtFoot {
  heightOfWindow: number;
  /** Room kept under the notices, or `NaN` to keep the default. */
  roomUnder: number;
  rem: number;
  topOfPinnedCard: number | null;
  rightOfCells: number;
  width: number;
  height: number;
}
/** What decides how far a notice lifts above the bar so that it keeps cells clear. */
export interface NoticeLiftQuestion {
  spot: NoticeBox;
  aboveBar: number;
  keptClear: NoticeBox[];
  topOfCells: number;
  gap: number;
  liftInUse: number | null;
}
/** The grid's boxes a notice must not cover: the active cell's and those of selected views. */
export interface BoxesOfGridForNotices<Box> {
  activeCellBox: Box | null;
  placedViews: readonly { isInView: boolean; isSelected: boolean; box: Box }[];
}
export function shouldNoticesSitAtFoot({
  isAtFoot,
  howManyUp,
  isAnyLeft,
  isFrontNew,
  spot,
  spotAtFoot,
  notToCover,
  betterNotCovered,
}: NoticesAtFootQuestion): boolean {
  if (howManyUp === 0) return isAtFoot && isAnyLeft;
  if (isAtFoot && !isFrontNew) return true;
  let stackLift = 14 * (howManyUp - 1);
  let spotLifted = {
    ...spot,
    bottom: spot.bottom + stackLift,
  };
  let spotAtFootLifted = {
    ...spotAtFoot,
    top: spotAtFoot.top - stackLift,
  };
  return (
    notToCover.some((box) => doNoticeBoxesOverlap(box, spotLifted)) ||
    (betterNotCovered.some((box) => doNoticeBoxesOverlap(box, spotLifted)) &&
      !notToCover.some((box) => doNoticeBoxesOverlap(box, spotAtFootLifted)))
  );
}
export function noticeSpotAtFoot({
  heightOfWindow,
  roomUnder,
  rem,
  topOfPinnedCard,
  rightOfCells,
  width,
  height,
}: NoticeRoomAtFoot): NoticeBox {
  let footLine = heightOfWindow - (Number.isNaN(roomUnder) ? 5.5 * rem : roomUnder);
  let stackBottom = topOfPinnedCard === null ? footLine - 0.75 * rem : topOfPinnedCard - rem;
  let stackRight = rightOfCells - rem;
  return {
    left: stackRight - width,
    top: stackBottom - height,
    right: stackRight,
    bottom: footLine,
  };
}
export function noticeLiftToClearCells({
  spot,
  aboveBar,
  keptClear,
  topOfCells,
  gap,
  liftInUse,
}: NoticeLiftQuestion): number {
  if (liftInUse !== null && liftInUse >= aboveBar) return liftInUse;
  let [firstKeptClear, ...restKeptClear] = keptClear;
  if (firstKeptClear === undefined) return aboveBar;
  let keptClearBox = restKeptClear.reduce(
    (union, box) => ({
      left: Math.min(union.left, box.left),
      top: Math.min(union.top, box.top),
      right: Math.max(union.right, box.right),
      bottom: Math.max(union.bottom, box.bottom),
    }),
    firstKeptClear,
  );
  let spotAboveBar = {
    ...spot,
    top: spot.top - aboveBar,
    bottom: spot.bottom - aboveBar,
  };
  if (!doNoticeBoxesOverlap(keptClearBox, spotAboveBar)) return aboveBar;
  let lift = spot.bottom - keptClearBox.top + gap;
  if (spot.top - lift >= topOfCells) return lift;
  return restKeptClear.length === 0
    ? aboveBar
    : noticeLiftToClearCells({
        spot,
        aboveBar,
        keptClear: [firstKeptClear],
        topOfCells,
        gap,
        liftInUse,
      });
}
export const NOTICE_STACK_STEP_PX = 14;
export const doNoticeBoxesOverlap = (box: NoticeBox, other: NoticeBox): boolean =>
  box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom;
export const boxesNoticesMustNotCover = <Box>({ activeCellBox, placedViews }: BoxesOfGridForNotices<Box>): Box[] => [
  ...(activeCellBox === null ? [] : [activeCellBox]),
  ...placedViews
    .filter(({ isInView, isSelected }) => isInView && isSelected)
    .map(({ box }) => box),
];
