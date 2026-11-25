/**
 * What this daemon says it can do in `hello` (`features`), and the protocol versions it speaks.
 *
 * The feature list lives in `@open-artifact/protocol` (`HARNESS_FEATURES`), so the kit's fake daemon answers the same
 * names; a name goes in there when the code that answers it lands here, never before.
 */

import { OpenArtifactError, PROTOCOL_MAX, PROTOCOL_MIN, type ProtocolRange } from '@open-artifact/protocol';

/** The features this daemon implements. */
export { HARNESS_FEATURES } from '@open-artifact/protocol';

/**
 * The protocol version a connection speaks: the highest both sides speak. A `hello` without `protocols` is protocol 1.
 * Throws `unsupported_protocol` when the ranges do not meet, saying which side must be upgraded.
 */
export function negotiateProtocol(asked: unknown): number {
  if (asked === undefined || asked === null) return Math.max(PROTOCOL_MIN, Math.min(1, PROTOCOL_MAX));
  const range = asked as Partial<ProtocolRange>;
  const min = range.min;
  const max = range.max;
  if (typeof asked !== 'object' || !Number.isInteger(min) || !Number.isInteger(max) || min! < 1 || max! < min!) {
    throw new OpenArtifactError('invalid_argument', 'hello.protocols is { min, max }: whole numbers, min ≤ max.');
  }
  const low = Math.max(min!, PROTOCOL_MIN);
  const high = Math.min(max!, PROTOCOL_MAX);
  if (low <= high) return high;
  if (max! < PROTOCOL_MIN) {
    throw new OpenArtifactError('unsupported_protocol', `The adapter speaks Harness API ${min}–${max}; this daemon speaks ${PROTOCOL_MIN}–${PROTOCOL_MAX}.`, {
      fix: 'Upgrade the adapter (its @open-artifact/harness-kit) to one that speaks this daemon’s protocol.',
    });
  }
  throw new OpenArtifactError('unsupported_protocol', `The adapter speaks Harness API ${min}–${max}; this daemon speaks ${PROTOCOL_MIN}–${PROTOCOL_MAX}.`, {
    fix: 'Upgrade the Open Artifact runtime (the open-artifact daemon) to one that speaks the adapter’s protocol.',
  });
}
