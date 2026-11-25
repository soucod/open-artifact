/**
 * The `snapshot` action's camera (headless Chrome over the DevTools protocol) lives in
 * `@open-artifact/server-sdk/snapshot`, shared with frame-host's `snapshot` action; this
 * module keeps the type server's own imports where they were.
 */
export { CANDIDATES, findChrome, snapshotPage, windowsCandidates, type SnapshotRequest } from '@open-artifact/server-sdk/snapshot';
