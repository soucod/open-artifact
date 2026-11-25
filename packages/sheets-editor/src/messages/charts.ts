import type { ChartFrameFault } from '../charts/frame-messages.ts';
import type { ChartEditOutcome } from '../state/controller.ts';
import type { PlacedViewDeletedOffer, PlacedViewDone } from '../state/initial-state.ts';
import { draftedText } from '@open-artifact/editor-kit';
import { translateMessage } from '../i18n/messages.ts';

/**
 * What came of sending words to the chat with the agent. `drafted`: taken, but put in the conversation for the person
 * to send there (the page says so instead of closing).
 */
export type AskSentToChat = 'taken' | 'drafted' | 'tooSoon' | 'failed' | 'notListening';

/** Whether the agent's chat took the words (`taken`, or `drafted` for the person to send). */
export const isAskTaken = (outcome: AskSentToChat | null): boolean => outcome === 'taken' || outcome === 'drafted';

/** Why a chart is not shown. */
export type ChartProblem = 'cantBeShown' | 'cantBeShownBeforeReload' | 'tooMuchData' | 'notLoaded' | 'paused';

/** What is wrong with the cells a chart draws. */
export type ChartCellsProblem = 'cellsHaveNoNumbers' | 'cellsHaveErrors';

/** Why a chart could not be changed on the page. */
export type ChartChangeRefusal = 'noAgent' | 'tooLarge' | 'forChat' | 'notHere' | 'notChanged';

/** What came of keeping a change to a chart: the step that made it, or why it may not have been made. */
export type ChartChangeOutcome = Extract<ChartEditOutcome, object> | 'notPointed' | 'showsAnother' | 'unsure';

export function askSentToChatWords(outcome: AskSentToChat): string {
  switch (outcome) {
    case 'taken':
      return translateMessage({
        defaultMessage: 'Continue in your chat with Agent.',
        id: 'vWypqhnbz9',
      });
    case 'drafted':
      // The Shell's words (English, or Simplified Chinese on a Chinese page), as every editor says them.
      return draftedText().sent;
    case 'tooSoon':
      return translateMessage({
        defaultMessage: 'Not sent. Try again in a few seconds.',
        id: 'GCTlVfzSrB',
      });
    case 'failed':
      return translateMessage({
        defaultMessage: 'Couldn’t send. Try again.',
        id: 'X87dNTQZvM',
      });
    case 'notListening':
      return translateMessage({
        defaultMessage: 'Agent isn’t listening to this Sheet. Ask it to wait for requests here, then try again.',
        id: 'oaChtNoLst1',
      });
  }
}
export function chartProblemOfFault(fault: ChartFrameFault): ChartProblem {
  if (fault === 'tookCaret') return 'cantBeShownBeforeReload';
  return fault === 'tooManyRows' ? 'tooMuchData' : 'cantBeShown';
}
export function chartProblemWords(problem: ChartProblem): { title: string; advice: string } {
  switch (problem) {
    case 'cantBeShown':
      return {
        title: chartCantBeShownTitle(),
        advice: translateMessage({
          defaultMessage: 'Ask Agent to fix it.',
          id: 'YMy04+hUO6',
        }),
      };
    case 'cantBeShownBeforeReload':
      return {
        title: chartCantBeShownTitle(),
        advice: translateMessage({
          defaultMessage: 'Ask Agent to fix it, then reload the page.',
          id: 'iloREi1bju',
        }),
      };
    case 'tooMuchData':
      return {
        title: translateMessage({
          defaultMessage: 'Too much data for this chart',
          id: 'EC1uMtnUz3',
        }),
        advice: translateMessage({
          defaultMessage: 'Ask Agent to use fewer rows.',
          id: '2ztD46c/YG',
        }),
      };
    case 'notLoaded':
      return {
        title: translateMessage({
          defaultMessage: 'This chart didn’t load',
          id: '8jYA5tk+zU',
        }),
        advice: translateMessage({
          defaultMessage: 'Reload the page to try again.',
          id: 'dbB77lhr1+',
        }),
      };
    case 'paused':
      return {
        title: translateMessage({
          defaultMessage: 'This chart is paused',
          id: 'FyU8YTO98Y',
        }),
        advice: translateMessage({
          defaultMessage: 'Another chart had a problem. Ask Agent to fix it, then reload the page.',
          id: '2RsH+gwYQL',
        }),
      };
  }
}
export function chartFixAsk(problem: ChartProblem): string | null {
  if (problem === 'cantBeShown')
    return translateMessage({
      defaultMessage: 'Fix this chart. It can’t be shown.',
      id: 'KnaErzwkF3',
    });
  if (problem === 'tooMuchData')
    return translateMessage({
      defaultMessage: 'Fix this chart. It has too much data.',
      id: 'Db2NJWi4/E',
    });
  return null;
}
export function placedViewMovedWords(change: PlacedViewDone): string {
  if (change.what === 'placedViewMoved')
    return translateMessage(
      {
        defaultMessage: 'Moved “{name}” to {cell}',
        id: '58TfPRkv6/',
      },
      {
        name: change.name,
        cell: change.cell,
      },
    );
  return translateMessage(
    {
      defaultMessage: '“{name}” is now {width} by {height} pixels',
      id: 'zxN+hD8sEj',
    },
    {
      name: change.name,
      width: change.widthInPixels,
      height: change.heightInPixels,
    },
  );
}
export function placedViewDeletedNotice({ name, isSaved }: PlacedViewDeletedOffer): { title: string; undoLabel: string } {
  return {
    title: isSaved
      ? translateMessage(
          {
            defaultMessage: 'Deleted “{name}”',
            id: 'fLyk8NMWCi',
          },
          {
            name,
          },
        )
      : translateMessage(
          {
            defaultMessage: 'Deleting “{name}”…',
            id: 'VtnK23bpgU',
          },
          {
            name,
          },
        ),
    undoLabel: translateMessage({
      defaultMessage: 'Undo delete',
      id: 'cOtS+51opL',
    }),
  };
}
export const chartMessages = {
  chartNamed: (name: string): string =>
    translateMessage(
      {
        defaultMessage: 'Chart: {name}',
        id: 'Ut5bs3JCIH',
      },
      {
        name,
      },
    ),
  keys: () =>
    translateMessage({
      defaultMessage: 'Use the arrow keys to move it, Shift and an arrow key to resize it, or Delete to delete it.',
      id: 'XYWD4/Hkt2',
    }),
  editWithAgent: () =>
    translateMessage({
      defaultMessage: 'Edit with Agent',
      id: 'xoZNLbgFl7',
    }),
  chart: () =>
    translateMessage({
      defaultMessage: 'Chart',
      id: '8qwiPwoMVr',
    }),
  typeToAskAgent: () =>
    translateMessage({
      defaultMessage: 'Start typing to ask Agent to change it.',
      id: 'kK0aiUTY4U',
    }),
  askAgentToChangeChart: () =>
    translateMessage({
      defaultMessage: 'Ask Agent to change this chart',
      id: 'S4u+1AAIan',
    }),
  changingChart: () =>
    translateMessage({
      defaultMessage: 'Changing the chart…',
      id: 'JeISFtmifq',
    }),
  changeIsPreview: () =>
    translateMessage({
      defaultMessage: 'This is a preview. Keep it?',
      id: 'YTWjyHN32c',
    }),
  stopChange: () =>
    translateMessage({
      defaultMessage: 'Stop',
      id: '2I+53rkxvc',
    }),
  keepChange: () =>
    translateMessage({
      defaultMessage: 'Keep',
      id: 'GJVIRRX97w',
    }),
  discardChange: () =>
    translateMessage({
      defaultMessage: 'Discard',
      id: '9l+c6y3w1s',
    }),
  previewDiscarded: () =>
    translateMessage({
      defaultMessage: 'Preview discarded',
      id: 'oxI3wQ7v/5',
    }),
  stoppedWithRequestKept: () =>
    translateMessage({
      defaultMessage: 'Stopped. Your request is still in the box.',
      id: 'D7iehvTUvW',
    }),
  stoppedWithRequestGone: () =>
    translateMessage({
      defaultMessage: 'Agent was stopped.',
      id: 'EzTtVCUt61',
    }),
  agentNotToBeHad: () =>
    translateMessage({
      defaultMessage: 'Agent isn’t available in this Sheet.',
      id: 'RwaqwgPN94',
    }),
  chartNotChanged: () =>
    translateMessage({
      defaultMessage: 'Couldn’t change the chart. Try again.',
      id: '85n7noButm',
    }),
  chartTooLarge: () =>
    translateMessage({
      defaultMessage: 'This chart is too large to change here.',
      id: 'e9bCGwtRRG',
    }),
  changeNeedsChat: () =>
    translateMessage({
      defaultMessage: 'This needs the chat. Press Enter to send it.',
      id: 'ibdGByvLVw',
    }),
  changeNeedsChatWithChart: () =>
    translateMessage({
      defaultMessage: 'This needs the chat. Press Enter to go there.',
      id: '34rR25+oGu',
    }),
  changeNotToBeHadHere: () =>
    translateMessage({
      defaultMessage: 'Agent can’t make this change here.',
      id: 'Ps7qWi+I9y',
    }),
  chartChanged: () =>
    translateMessage({
      defaultMessage: 'Chart changed',
      id: 'AFmvPjd/+6',
    }),
  undoChangeOfChart: () =>
    translateMessage({
      defaultMessage: 'Undo the change to the chart',
      id: 'iPKiijeUYE',
    }),
  changeNotKept: () =>
    translateMessage({
      defaultMessage: 'Couldn’t keep the change to the chart. Ask for it again.',
      id: 'mfUvPB4xRR',
    }),
  changeNotKeptOverAnother: () =>
    translateMessage({
      defaultMessage: 'The chart has changed, so your change wasn’t kept.',
      id: '0E0mUpVXF3',
    }),
  changePerhapsKept: () =>
    translateMessage({
      defaultMessage: 'The change to the chart may not have been kept.',
      id: 'vyoPpKlbvJ',
    }),
  toolIsNotForCharts: () =>
    translateMessage({
      defaultMessage: 'Not for charts.',
      id: 'bHklIB5Y+q',
    }),
  askAgentToFix: () =>
    translateMessage({
      defaultMessage: 'Ask Agent to fix',
      id: 'WvKcpc7yCN',
    }),
  menuOfChart: () =>
    translateMessage({
      defaultMessage: 'Chart actions',
      id: 'ElIIWP/XYn',
    }),
  copyChart: () =>
    translateMessage({
      defaultMessage: 'Copy',
      id: 'OKtyStEHrH',
    }),
  deleteChart: () =>
    translateMessage({
      defaultMessage: 'Delete chart',
      id: '+DkjqYv9Hn',
    }),
};
export const chartCantBeShownTitle = () =>
  translateMessage({
    defaultMessage: 'This chart can’t be shown',
    id: 'hdBogsDJMx',
  });
export const chartCellsProblemWords = (problem: ChartCellsProblem): string =>
  problem === 'cellsHaveNoNumbers'
    ? translateMessage({
        defaultMessage: 'This chart’s cells have no numbers.',
        id: '4k6lzvbLKE',
      })
    : translateMessage({
        defaultMessage: 'This chart’s cells have errors.',
        id: '1UNr5PuiiA',
      });
export const placedViewChangeUndoneWords = ({ what, name }: PlacedViewDone): string =>
  what === 'placedViewChangeUndone'
    ? translateMessage(
        {
          defaultMessage: 'Undone: “{name}”',
          id: '08z8KM96Rw',
        },
        {
          name,
        },
      )
    : translateMessage(
        {
          defaultMessage: 'Redone: “{name}”',
          id: '2B1YZLHrAJ',
        },
        {
          name,
        },
      );
export const chartChangeRefusalWords = (refusal: ChartChangeRefusal, forChat: boolean): string =>
  ({
    noAgent: chartMessages.agentNotToBeHad,
    tooLarge: chartMessages.chartTooLarge,
    forChat: forChat ? chartMessages.changeNeedsChat : chartMessages.changeNeedsChatWithChart,
    notHere: chartMessages.changeNotToBeHadHere,
    notChanged: chartMessages.chartNotChanged,
  })[refusal]();
export const chartChangeOutcomeWords = (outcome: ChartChangeOutcome): string =>
  ({
    pointed: chartMessages.chartChanged,
    notPointed: chartMessages.changeNotKept,
    showsAnother: chartMessages.changeNotKeptOverAnother,
    unsure: chartMessages.changePerhapsKept,
  })[typeof outcome === 'object' ? 'pointed' : outcome]();
