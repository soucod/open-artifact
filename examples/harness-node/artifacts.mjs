/**
 * Artifact cards: `on('artifact')` reports each artifact a session created, changed or removed, and the host keeps one
 * card per artifact in that session's chat — the stable `open-artifact://` link is the key, since the page address
 * changes with the daemon's port.
 */

/** The card a report draws, or `null` for a removed artifact. */
export function cardOf(report) {
  if (report.change === 'removed') return null;
  const { artifact } = report;
  return { url: artifact.url, title: artifact.title, type: artifact.type, thumbnail: artifact.thumbnail, updatedAt: artifact.updatedAt };
}

/** Cards by session, kept up to date from `on('artifact')`. Returns the cards map and a function that stops. */
export function followArtifacts(oa, { onCard = () => undefined } = {}) {
  /** Session id (or `''` for none) → artifact url → card. */
  const cards = new Map();
  const stop = oa.on('artifact', (report) => {
    const card = cardOf(report);
    if (card) {
      const key = report.session ?? '';
      if (!cards.has(key)) cards.set(key, new Map());
      cards.get(key).set(card.url, card);
    } else {
      // A removal names no session (the artifact is gone): drop its card wherever it is.
      for (const table of cards.values()) table.delete(report.artifact.url);
    }
    onCard(report, card);
  });
  return { cards, stop };
}
