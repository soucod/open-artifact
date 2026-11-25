/**
 * A typed face on the engine: requests go in as objects and answers come out
 * parsed, typed by the request's `kind`. Nothing here depends on where the
 * engine runs.
 */

import type { EngineSession, PackedCellBlock, SheetsEngine } from '@open-artifact/wasm-sheets';
import type { PackedReadRequest } from './packed.ts';
import type { Refused } from './refusals.ts';
import type { SessionKind, SessionKinds, SessionRequest } from './sync.ts';
import type { FunctionDescriptions, UtilityKind, UtilityKinds, UtilityRequest } from './utility.ts';

/** The answer a session request gets, by its kind; any request may be refused. */
export type AnswerOf<R extends SessionRequest> = R['kind'] extends SessionKind
  ? SessionKinds[R['kind']]['answer'] | Refused
  : never;

/** The answer a utility request gets, by its kind; any request may be refused. */
export type UtilityAnswerOf<R extends UtilityRequest> = R['kind'] extends UtilityKind
  ? UtilityKinds[R['kind']]['answer'] | Refused
  : never;

/** One workbook session, its requests and answers typed. */
export class EngineClient {
  readonly session: EngineSession;

  constructor(session: EngineSession) {
    this.session = session;
  }

  /** A request about the workbook, and its answer. */
  request<R extends SessionRequest>(request: R): AnswerOf<R> {
    return JSON.parse(this.session.answerJson(JSON.stringify(request))) as AnswerOf<R>;
  }

  /** A packed read, and its answer; the answer's blocks go to `take`, in their order, before it returns. */
  requestWithCells<R extends PackedReadRequest>(request: R, take: (block: PackedCellBlock) => void): AnswerOf<R> {
    return JSON.parse(this.session.answerWithCells(JSON.stringify(request), take)) as AnswerOf<R>;
  }

  /** Frees the workbook; the client cannot be used afterwards. */
  free(): void {
    this.session.free();
  }
}

/** The engine's requests that need no workbook, typed. */
export class UtilityClient {
  readonly engine: SheetsEngine;

  constructor(engine: SheetsEngine) {
    this.engine = engine;
  }

  /** A request that needs no workbook, and its answer. */
  request<R extends UtilityRequest>(request: R): UtilityAnswerOf<R> {
    return JSON.parse(this.engine.utilityJson(JSON.stringify(request))) as UtilityAnswerOf<R>;
  }

  /** Every function a formula may call. */
  functionDescriptions(): FunctionDescriptions {
    return JSON.parse(this.engine.functionDescriptionsJson()) as FunctionDescriptions;
  }

  /** A new workbook session. */
  session(): EngineClient {
    return new EngineClient(this.engine.session());
  }
}

/** A utility request answered by an engine, typed. */
export function utility<R extends UtilityRequest>(engine: SheetsEngine, request: R): UtilityAnswerOf<R> {
  return new UtilityClient(engine).request(request);
}
