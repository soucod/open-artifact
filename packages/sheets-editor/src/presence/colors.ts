import { leastUsedPeerColor, normalizePeerColor, peerColorFor } from '@open-artifact/editor-kit';

export const SHEETS_NEVER_GIVEN_COLORS: readonly string[] = ['#d25f25', '#257de0'];

/** The color of a person's flags: the color they claim when it may be given, else one from their usual color and id. */
export function peerColorOf(claimedColor: string | null | undefined, usualColor: string | null, userId: string): string {
  const claimed = normalizePeerColor(claimedColor);
  const isClaimable = claimed !== undefined && !SHEETS_NEVER_GIVEN_COLORS.includes(claimed);
  return leastUsedPeerColor(peerColorFor(isClaimable ? claimed : usualColor, userId)
, [], SHEETS_NEVER_GIVEN_COLORS);
}
