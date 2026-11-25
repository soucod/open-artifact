/**
 * Helpers for the redirect providers: their callback address and outbound JSON.
 */

import type { HostConfig } from '../types.ts';

/** The callback address a redirect provider registers with its issuer: `<app>/auth/<id>/callback`. */
export function callbackUrl(config: Pick<HostConfig, 'appOrigin'>, providerId: string): string {
  return `${config.appOrigin}/auth/${providerId}/callback`;
}

/** Outbound JSON with a timeout; a network failure, non-2xx or non-JSON answer throws `Error`. */
export async function fetchJson(fetcher: typeof fetch, url: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  const response = await fetcher(url, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} answered ${response.status}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${url} did not answer JSON`);
  }
}

/** An object's string field, or undefined. */
export function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field !== '' ? field : undefined;
}
