/** What each typeahead menu lists for its query. */
import { getDocs } from '../app/store.ts';
import { canAskInText, openAsk } from '../ask/actions.ts';
import { searchEmoji } from './emoji.ts';
import { mentionOptions } from './mentions.ts';
import { knownPeople } from './people.ts';
import type { MenuOption, OptionSource } from './plugin.ts';
import { slashSource } from './slash-items.ts';

export const mentionSource: OptionSource = query => {
  const project = getDocs().project;
  return mentionOptions(query, {
    people: knownPeople(),
    files: project?.files ?? [],
    enums: project?.enums ?? [],
    ...(canAskInText() ? { askAgent: openAsk } : {}),
  });
};

export const emojiSource: OptionSource = query =>
  query.length < 2
    ? []
    : searchEmoji(query).map(
        (hit): MenuOption => ({
          id: hit.code,
          label: `:${hit.code}:`,
          glyph: hit.emoji,
          run(view, range) {
            view.dispatch(view.state.tr.insertText(hit.emoji, range.from, range.to).scrollIntoView());
            view.focus();
          },
        }),
      );

export { slashSource };
