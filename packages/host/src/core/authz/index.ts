/**
 * Authorization: a principal's role on an artifact (`roles.ts`, pure over the rows) and the live lookup a page
 * token's holder goes through on every content-origin request (`access.ts`, over the catalog).
 */
export * from './roles.ts';
export * from './access.ts';
