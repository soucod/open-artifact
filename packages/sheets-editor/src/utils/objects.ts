export const isNonNullObject = (value: unknown): value is Record<PropertyKey, unknown> => typeof value === 'object' && value !== null;
