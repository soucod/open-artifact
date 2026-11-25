import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { StillsError, parseStillScale, parseStillTimes, stillFileName } from '@open-artifact/motion-stage/stills';
import { stillsRequest } from '../src/stills-cli.ts';

const flags = (entries: [string, string | true][] = []): Map<string, string | true> => new Map(entries);

test('stills takes the folder and the times by --at, at full size and final by default', () => {
  assert.deepEqual(stillsRequest(['film'], flags([['at', '1.5,4']])), { root: resolve('film'), times: [1.5, 4], scale: 1, mode: 'final', out: null });
});

test('stills takes the times as a second argument too, with a scale, a folder and rough scenes', () => {
  const request = stillsRequest(['film', '0,2.25'], flags([['scale', '0.5'], ['out', 'stills'], ['rough', true]]));
  assert.deepEqual(request, { root: resolve('film'), times: [0, 2.25], scale: 0.5, mode: 'rough', out: resolve('stills') });
});

test('stills refuses what it cannot draw', () => {
  const refuses = (positional: string[], entries: [string, string | true][], message: RegExp): void =>
    assert.throws(() => stillsRequest(positional, flags(entries)), (error: unknown) => error instanceof StillsError && message.test(error.message));
  refuses([], [], /Pass the artifact folder/);
  refuses(['film'], [], /Pass the times/);
  refuses(['film'], [['at', true]], /--at takes/);
  refuses(['film', '1'], [['at', '2']], /Unexpected argument: 1/);
  refuses(['film'], [['at', '1,-2']], /played seconds/);
  refuses(['film'], [['at', '1,,2']], /played seconds/);
  refuses(['film'], [['at', '1'], ['scale', '5']], /--scale/);
  refuses(['film'], [['at', '1'], ['scale', true]], /--scale/);
  refuses(['film'], [['at', '1'], ['out', true]], /--out/);
});

test('times, scales and file names', () => {
  assert.deepEqual(parseStillTimes('0.8, 2.4,5'), [0.8, 2.4, 5]);
  assert.equal(parseStillTimes('a'), null);
  assert.equal(parseStillScale(undefined), 1);
  assert.equal(parseStillScale('4'), 4);
  assert.equal(parseStillScale('0'), null);
  assert.equal(stillFileName(1.5), 't_1.500.png');
});
