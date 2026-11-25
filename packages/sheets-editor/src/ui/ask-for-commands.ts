import type { AgentSampler } from '../agent/sampling.ts';
import { MAX_CELLS_SEEN } from '../selection/cells-seen.ts';
import {
  commandsNameableFromWords,
  commandsFromWordsRequest,
  commandIdsAnswered,
  type CommandForAgent,
  type CommandScope,
  type SelectionForCommands,
} from './commands-from-words.ts';
export function commandScopeOfSelection({ areas: [onlyArea, ...otherAreas], cellsAre }: Pick<SelectionForCommands, 'areas' | 'cellsAre'>): CommandScope {
  if (
    !(
      onlyArea !== undefined &&
      otherAreas.length === 0 &&
      onlyArea.rowCount > 0 &&
      onlyArea.columnCount > 0 &&
      onlyArea.rowCount * onlyArea.columnCount <= MAX_CELLS_SEEN
    )
  )
    return 'none';
  if (cellsAre === 'date') return 'forDates';
  return cellsAre === 'number' || cellsAre === 'empty' ? 'all' : 'none';
}
/** Asks the agent which of the commands do what the words say; answers with their ids. */
export type AskForCommands = (words: string, commands: readonly CommandForAgent[], signal: AbortSignal) => Promise<string[]>;
export function makeAskForCommands(
  agentForCommands: Pick<AgentSampler, 'ask' | 'stop'>,
  selectionInfo: () => SelectionForCommands,
): AskForCommands {
  let stop = () => agentForCommands.stop();
  return async (words, commands, signal) => {
    let selection = selectionInfo();
    let nameableCommands = commandsNameableFromWords(commands, commandScopeOfSelection(selection));
    let request = commandsFromWordsRequest(words, selection, nameableCommands);
    if (request === null) return [];
    signal.throwIfAborted();
    signal.addEventListener('abort', stop, {
      once: true,
    });
    try {
      let reply = await agentForCommands.ask(request, () => {
        return;
      });
      if (reply.kind !== 'answered') throw Error(`no answer: ${reply.kind}`);
      return commandIdsAnswered(reply.answer, nameableCommands);
    } finally {
      signal.removeEventListener('abort', stop);
    }
  };
}
