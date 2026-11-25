import { Avatar } from '../kit/avatar.tsx';
import * as React from 'react';
import { FieldOfChips, type ChipInField, type FieldOfChipsProps } from './field-of-chips.tsx';
import { peoplePickerMessages } from '../i18n/chip-labels.ts';
import type { ProfileOfPerson } from './people-list.ts';
import { PERSON_AVATAR_LOOK } from './person-avatar-look.ts';
export interface PeopleFieldProps extends Omit<FieldOfChipsProps, 'mostWidth' | 'chips' | 'hint' | 'onChipRemoved'> {
  people: readonly ProfileOfPerson[] | null;
  chipGoneTo: string | null;
  onPersonRemoved: (userId: string) => void;
}
export function PeopleField({ people, chipGoneTo, onPersonRemoved, ...fieldProps }: PeopleFieldProps) {
  let peopleShown = people ?? NO_PEOPLE;
  let chips = React.useMemo(
    () =>
      peopleShown.map(
        ({ userId, name, avatarUrl }): ChipInField => ({
          key: userId,
          name,
          isGoneTo: userId === chipGoneTo,
          chip: {
            optionPaints: null,
            showsPeople: true,
            before: <Avatar {...PERSON_AVATAR_LOOK} name={name} src={avatarUrl} size="xs" aria-hidden />,
            children: name,
          },
        }),
      ),
    [peopleShown, chipGoneTo],
  );
  let removeChip = React.useCallback(
    (chipKey: string) => {
      let person = peopleShown.find(({ userId }) => userId === chipKey);
      if (person !== undefined) onPersonRemoved(person.userId);
    },
    [peopleShown, onPersonRemoved],
  );
  return <FieldOfChips mostWidth={PEOPLE_FIELD_MOST_WIDTH} chips={chips} hint={addPeopleHint(peopleShown)} onChipRemoved={removeChip} {...fieldProps} />;
}
export const PEOPLE_FIELD_MOST_WIDTH = 480;
export const NO_PEOPLE: readonly ProfileOfPerson[] = [];
export const addPeopleHint = (people: readonly ProfileOfPerson[]): string =>
  people.length === 0 ? peoplePickerMessages.addPeople() : peoplePickerMessages.addMore();
