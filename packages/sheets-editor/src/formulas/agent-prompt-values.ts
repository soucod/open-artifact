import { FUNCTION_CATALOG } from './function-catalog.ts';
export const ARRAY_FUNCTION_NAMES = FUNCTION_CATALOG.filter(({ answers }) => answers === 'anArray').map(
  ({ name }) => name,
);
