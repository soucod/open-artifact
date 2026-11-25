import { Tooltip, TooltipGroup, type TooltipSide } from '../kit/tooltip.tsx';
import { Icon } from '../kit/icon.tsx';
import * as React from 'react';
import { ROW_HEADER_WIDTH } from './cell-metrics-values.ts';
import { cellPaddingBeside } from './cell-metrics.ts';
import { OUTLINE_LANE_SIZE, OUTLINE_MARK_SIZE, type OutlineBracket, type OutlineGutter, type OutlineGutters, type OutlineMark } from './outline-groups.ts';
import { lineGroupsLabel, showToLevelLabel, toggleGroupLabel } from '../messages/line-groups.ts';
import { zoomedStyle } from './zoom.ts';
import { preventMouseDownDefault } from '../ui/dom-events.ts';
import type { CellDensity } from './cell-metrics-values.ts';
import type { LinesAxisName } from './geometry.ts';
export interface GroupMarginProps {
  ref: React.Ref<HTMLFieldSetElement>;
  margin: OutlineGutter;
  zoom: number;
  onMarkPressed: (of: LinesAxisName, group: OutlineMark) => void;
  onLevelChosen: (of: LinesAxisName, level: number) => void;
}
export const groupLevelCount = (margin: OutlineGutter | null): number => margin?.size ?? 0;
export const groupMarginRoomStyle = ({ rows, columns }: OutlineGutters, zoom: number) => ({
  '--sheet-room-for-row-groups': `${groupLevelCount(rows) * zoom}px`,
  '--sheet-room-for-column-groups': `${groupLevelCount(columns) * zoom}px`,
});
export const gridHeaderRoomStyle = (rowGroupsRoom: number, zoom: number, density: CellDensity) => ({
  '--sheet-room-for-row-groups': `${rowGroupsRoom * zoom}px`,
  '--sheet-row-numbers-width': `${ROW_HEADER_WIDTH * zoom}px`,
  '--sheet-clear-before-text-of-cell': `${cellPaddingBeside(density) * zoom}px`,
});
export const groupMarginPosition = (of: LinesAxisName, along: number, across: number) =>
  of === 'rows'
    ? {
        top: along,
        left: across,
      }
    : {
        left: along,
        top: across,
      };
export const groupLaneCenter = (lane: number): number => (lane + 0.5) * OUTLINE_LANE_SIZE;
export const GROUP_MARK_HALF_SIZE = OUTLINE_MARK_SIZE / 2;
export const groupBracketStart = ({ start, startsBeforeMark }: OutlineBracket): number =>
  startsBeforeMark ? start : start + GROUP_MARK_HALF_SIZE;
export const groupBracketEnd = ({ end, endsInView }: OutlineBracket): number => (endsInView ? end - 1 : end);
export const isSameMarginGroup = (group: OutlineMark, previous: OutlineMark | undefined): boolean =>
  previous !== undefined &&
  group.key === previous.key &&
  group.groupIds.length === previous.groupIds.length &&
  group.lane === previous.lane &&
  group.isCollapsed === previous.isCollapsed &&
  group.markAt === previous.markAt &&
  group.first === previous.first &&
  group.last === previous.last &&
  group.line?.start === previous.line?.start &&
  group.line?.end === previous.line?.end &&
  group.line?.endsInView === previous.line?.endsInView &&
  group.line?.startsBeforeMark === previous.line?.startsBeforeMark;
export const areGroupMarginPropsEqual = (props: GroupMarginProps, previousProps: GroupMarginProps): boolean =>
  props.zoom === previousProps.zoom &&
  props.ref === previousProps.ref &&
  props.onMarkPressed === previousProps.onMarkPressed &&
  props.onLevelChosen === previousProps.onLevelChosen &&
  props.margin.levelCount === previousProps.margin.levelCount &&
  props.margin.hasLevelButtons === previousProps.margin.hasLevelButtons &&
  props.margin.groups.length === previousProps.margin.groups.length &&
  props.margin.groups.every((group: OutlineMark, index: number) => isSameMarginGroup(group, previousProps.margin.groups[index]));
export const GroupMargin = React.memo(function ({
  ref,
  margin,
  zoom,
  onMarkPressed,
  onLevelChosen,
}: GroupMarginProps) {
  let { of, beforeBody, levelCount, hasLevelButtons, groups } = margin;
  let tooltipSide: TooltipSide = of === 'rows' ? 'right' : 'bottom';
  return <fieldset ref={ref} aria-label={lineGroupsLabel(of)} className="sheet-group-margin" data-of={of}><div role="presentation" className="sheet-group-margin-zoomed" style={zoomedStyle(zoom)}><TooltipGroup><div role="presentation" className="sheet-group-levels" style={of === 'rows'
                ? {
                    height: beforeBody,
                  }
                : {
                    width: beforeBody,
                  }}>{Array.from(
              {
                length: hasLevelButtons ? levelCount : 0,
              },
              (_slot, index) => index + 1,
            ).map(
              (level: number) =>
                <Tooltip key={level} content={showToLevelLabel(of, level)} side={tooltipSide}><button type="button" tabIndex={-1} className="sheet-group-level" aria-label={showToLevelLabel(of, level)} onMouseDown={preventMouseDownDefault} onClick={() => onLevelChosen(of, level)}>{level}</button></Tooltip>,
            )}</div><div role="presentation" className="sheet-group-lanes" style={of === 'rows'
                ? {
                    top: beforeBody,
                  }
                : {
                    left: beforeBody,
                  }}>{groups.map(
                ({ key, lane, line }: OutlineMark) =>
                  line !== null &&
                  groupBracketEnd(line) > groupBracketStart(line) &&
                  (<div key={key} aria-hidden className="sheet-group-bracket" data-ends-in-view={line.endsInView || undefined} data-starts-before-mark={line.startsBeforeMark || undefined} style={{
                        ...groupMarginPosition(of, groupBracketStart(line), groupLaneCenter(lane)),
                        [of === 'rows' ? 'height' : 'width']: groupBracketEnd(line) - groupBracketStart(line),
                      }} />),
              )}{groups.map((group: OutlineMark) => {
                let label = toggleGroupLabel(
                  {
                    of,
                    ...group,
                  },
                  group.isCollapsed,
                );
                return <Tooltip key={group.key} content={label} side={tooltipSide}><button type="button" tabIndex={-1} className="sheet-group-mark" aria-label={label} aria-expanded={!group.isCollapsed} style={groupMarginPosition(of, group.markAt, groupLaneCenter(group.lane))} onMouseDown={preventMouseDownDefault} onClick={() => onMarkPressed(of, group)}><Icon name={group.isCollapsed ? 'Add' : 'Minus'} size="xs" /></button></Tooltip>;
              })}</div></TooltipGroup></div></fieldset>;
}, areGroupMarginPropsEqual);
