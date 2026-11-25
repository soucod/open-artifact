import { ContextMenu } from '../../kit/context-menu.tsx';
import { Menu } from '../../kit/menu.tsx';
import * as React from 'react';
import { CommandRows } from '../menu-with-field.tsx';
import type { ReactNode } from 'react';
import type { IconName } from '../../kit/icon.tsx';
import type { MenuCommand, SearchableCommand } from '../search-menu/matching.ts';
import type { SuggestedRuleCommand } from './rule-commands.tsx';
interface SuggestedRulesWantedProps {
  onAsked(): void;
}
export function SuggestedRulesWanted({ onAsked }: SuggestedRulesWantedProps) {
  React.useLayoutEffect(onAsked, [onAsked]);
  return null;
}
/** Shows a suggested rule on the cells while its row is pointed at, and stops when it is no longer offered. */
export interface RuleTryOn {
  tryOnCells(command: Pick<SearchableCommand, 'id'>, isOn: boolean): void;
  noteTaken(): void;
}
export function useRuleTryOn(suggestions: readonly SuggestedRuleCommand[]): RuleTryOn {
  const triedRef = React.useRef<SuggestedRuleCommand | null>(null);
  React.useEffect(() => () => triedRef.current?.tryOnCells(false), []);
  React.useEffect(() => {
    const tried = triedRef.current;
    if (tried === null || suggestions.some(({ id, gives }) => id === tried.id && gives === tried.gives)) return;
    triedRef.current = null;
    tried.tryOnCells(false);
  });
  return {
    tryOnCells(command, isOn) {
      const suggestion = suggestions.find(({ id }) => id === command.id) ?? null;
      if ((triedRef.current?.id === suggestion?.id) === isOn) return;
      triedRef.current = isOn ? suggestion : null;
      suggestion?.tryOnCells(isOn);
    },
    noteTaken() {
      triedRef.current = null;
    },
  };
}
interface SuggestedRuleRowsProps {
  heading: string | null;
  suggestions: readonly SuggestedRuleCommand[];
  openers: readonly MenuCommand[];
  isPointerCoarse: boolean;
  onTaken(command: MenuCommand, isByKey: boolean): void;
}
export function SuggestedRuleRows({
  heading,
  suggestions,
  openers,
  isPointerCoarse,
  onTaken,
}: SuggestedRuleRowsProps) {
  const ruleTryOn = useRuleTryOn(suggestions);
  if (suggestions.length === 0 && openers.length === 0) return null;
  const suggestionRows = <CommandRows commands={suggestions} isRowUnderEnterLit isPointerCoarse={isPointerCoarse} describe={({ id }) => suggestions.find((suggestion) => suggestion.id === id)?.where ?? null} onPointedAt={ruleTryOn.tryOnCells} onTaken={(command, isByKey) => {
      ruleTryOn.noteTaken();
      onTaken(command, isByKey);
    }} />;
  const openerRows = <CommandRows commands={openers} isRowUnderEnterLit isPointerCoarse={isPointerCoarse} describe={() => null} onTaken={onTaken} />;
  return <>{suggestions.length > 0 &&
        (<ContextMenu.Group>{heading !== null &&
              <Menu.GroupLabel>{heading}</Menu.GroupLabel>}{suggestionRows}</ContextMenu.Group>)}{suggestions.length > 0 && openers.length > 0 && <ContextMenu.Separator />}{openerRows}</>;
}
interface SuggestedRulesSubmenuProps extends Omit<SuggestedRuleRowsProps, 'heading'> {
  icon: IconName;
  label: ReactNode;
  headingOfSuggestions: string;
}
export const SuggestedRulesSubmenu = ({
  icon,
  label,
  headingOfSuggestions,
  ...rowsProps
}: SuggestedRulesSubmenuProps) =>
  <ContextMenu.Submenu><ContextMenu.SubmenuTrigger icon={icon}>{label}</ContextMenu.SubmenuTrigger><ContextMenu.SubmenuPopup><SuggestedRuleRows {...rowsProps} heading={rowsProps.suggestions.length > 0 ? headingOfSuggestions : null} /></ContextMenu.SubmenuPopup></ContextMenu.Submenu>;
