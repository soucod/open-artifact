import { translateMessage } from '../i18n/messages.ts';
import { AGENT_NAME } from '../agent/agent-name.ts';
export const toolSearchMessages = {
  suggestTools: () =>
    translateMessage({
      defaultMessage: 'Suggest tools',
    }),
  findingTools: () =>
    translateMessage({
      defaultMessage: 'Finding tools…',
    }),
  noTool: () =>
    translateMessage({
      defaultMessage: 'No tool for this',
    }),
  couldNotSuggest: () =>
    translateMessage({
      defaultMessage: 'Couldn’t suggest tools',
    }),
  namesOfAgent: (): Set<string> =>
    new Set<string>(
      `${translateMessage({
        defaultMessage: 'ai agent assistant chatbot',
      })} ${AGENT_NAME.toLowerCase()}`
        .split(/[^\p{L}\p{M}\p{N}]+/u)
        .filter((word: string) => word !== ''),
    ),
  wordsOfAQuestion: (): Set<string> =>
    new Set<string>(
      translateMessage({
        defaultMessage: 'ask why how what explain if',
      }).split(/[^\p{L}\p{M}\p{N}]+/u),
    ),
  littleWords: (): Set<string> =>
    new Set<string>(
      translateMessage({
        defaultMessage:
          'a an the this that these those here there it its for and or to of in on as at by if is are be with all my me i you we please make add put show set get turn give want need can based from into than when then them some more less very like cell cells',
      }).split(/\s+/),
    ),
};
