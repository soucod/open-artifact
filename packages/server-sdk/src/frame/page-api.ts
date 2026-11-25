import type { FrameDatabase } from './page-db.ts';
import type { FrameServices } from './page-services.ts';
import type { FrameComments } from './page-comments.ts';

/** Namespaces the page host can supply. Each viewer's grants determine availability. */
export interface PageCapabilities extends FrameServices {
  db: FrameDatabase;
  comments: FrameComments;
  hot: {
    readonly data: undefined;
    readonly from: null;
    readonly gen: 0;
    readonly signal: undefined;
    snapshot(...args: unknown[]): void;
    ready(...args: unknown[]): void;
    accept(...args: unknown[]): void;
    restart(...args: unknown[]): void;
  };
}

/** Unknown names have no statically known operations. */
export type PageNamespace<Name extends string> =
  Name extends keyof PageCapabilities ? Readonly<PageCapabilities[Name]> : Readonly<Record<string, unknown>>;

type WaitingMember<Member> =
  Member extends (...args: infer Args) => infer Result
    ? Result extends (() => void) ? (...args: [...Args, onError?: (reason: unknown) => void]) => Result
      : Result extends Promise<unknown> ? Member : (...args: Args) => Promise<Awaited<Result>>
    : unknown;

type WaitingNamespace<Name extends string> = {
  readonly [Key in keyof PageNamespace<Name>]: WaitingMember<PageNamespace<Name>[Key]>;
};

/** A granted reference has synchronous builders. Before the grant, ordinary calls queue
 * and listeners return a cancellation function immediately. The same reference is updated in place. */
export type PageReference<Name extends string> =
  | (PageNamespace<Name> & { readonly available: true })
  | (WaitingNamespace<Name> & { readonly available: false });

export interface PageImportOptions { contract?: string }

/** The injected page API exposes initial grants directly and resolves missing grants to null. */
export type FramePageRuntime = Readonly<Partial<PageCapabilities>> & {
  readonly contract: string;
  readonly hot: Readonly<PageCapabilities['hot']>;
  use<Name extends string>(name: Name): Promise<PageNamespace<Name> | null>;
};

export type * from './page-db.ts';
export type * from './page-comments.ts';
export type * from './page-services.ts';
