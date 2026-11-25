// Compile these as an SDK consumer, through the exported paths.
import type { default as load, at } from '@open-artifact/server-sdk/frame/imports';
import type { FramePageRuntime, FrameDbError, FrameDocSnapshot, FrameDocumentChange } from '@open-artifact/server-sdk/frame/page-api';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type DbImport = ReturnType<typeof at<'db'>>;
type Db = Extract<DbImport, { available: true }>;
type Ref = ReturnType<Db['doc']>;
type Query = Awaited<ReturnType<ReturnType<Db['collection']>['get']>>;
type Lease = Awaited<ReturnType<Ref['acquire']>>;
type Room = Extract<ReturnType<typeof at<'room'>>, { available: true }>;

export type PageTypeChecks = [
  Expect<Equal<Awaited<ReturnType<typeof load<'db'>>>, DbImport>>,
  Expect<Equal<Awaited<ReturnType<Ref['get']>>, FrameDocSnapshot>>,
  Expect<Equal<Query['docs'], readonly FrameDocSnapshot[]>>,
  Expect<Equal<ReturnType<Query['docChanges']>, readonly FrameDocumentChange[]>>,
  Expect<Equal<Extract<Lease, {acquired:true}>['version'], number>>,
  Expect<Equal<NonNullable<Parameters<Ref['onSnapshot']>[1]>, (error: FrameDbError) => void>>,
  Expect<Equal<ReturnType<Ref['onSnapshot']>, () => void>>,
  Expect<Equal<Awaited<ReturnType<Extract<DbImport, {available:false}>['doc']>>, Ref>>,
  Expect<Equal<ReturnType<Room['peers']>[number]['by'], string | null>>,
  Expect<Equal<ReturnType<typeof at<'self'>>, ReturnType<typeof at<'artifact'>>>>,
  Expect<Equal<ReturnType<typeof at<'unknown-service'>>['missingMethod'], unknown>>,
  Expect<Equal<Awaited<ReturnType<FramePageRuntime['use']>>, Readonly<Record<string, unknown>> | null>>
];
