import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filmSeconds, playSeconds } from '@open-artifact/motion-core';
import type { NarrationData, NarrationLine } from '@open-artifact/motion-core';
import { captionCues, cueAt, voiceoverLines } from '../src/narration/captions.ts';
import {
  CUT_FADE_SECONDS,
  cutSamples,
  decodeNarration,
  isClipContainer,
  judgeCut,
  judgeSourceBytes,
  judgeSourceSeconds,
  judgeTakeBytes,
  judgeTakeSeconds,
} from '../src/narration/decode.ts';
import type { TakeDecoder } from '../src/narration/decode.ts';
import { DUCK_ATTACK_SECONDS, DUCK_RELEASE_SECONDS, duckEnvelope, sampleEnvelope } from '../src/narration/duck.ts';
import { DEFAULT_NARRATION_LIMITS } from '../src/narration/limits.ts';
import { voicePeaks } from '../src/narration/peaks.ts';
import { clipCaption, planNarration, takeKey } from '../src/narration/plan.ts';
import { placeSpeech } from '../src/narration/speech.ts';
import { identityTimeline, segmentTimeline } from '../src/timeline.ts';
import { encodePcmWave, parsePcmWave } from '../src/wave.ts';

const film = filmSeconds;
const play = playSeconds;
const line = (at: number, dur: number, audio: string, text = 'Words.'): NarrationLine => ({ at: film(at), dur, audio, text });

/** Enough of an AudioBuffer for the narration code: its length and its first channel. */
function fakeBuffer(seconds: number, sampleRate = 100): AudioBuffer {
  const samples = new Float32Array(Math.round(seconds * sampleRate)).map((_unused, index) => Math.sin(index / 3) * 0.5);
  const fake = { duration: seconds, length: samples.length, sampleRate, numberOfChannels: 1, getChannelData: () => samples };
  return fake as unknown as AudioBuffer;
}

describe('planning narration', () => {
  it('keeps lines that start within the film and fit a line, in time order', () => {
    const data: NarrationData = { lines: [line(5, 2, 'b'), line(1, 2, 'a'), line(-1, 1, 'x'), line(10, 1, 'y'), line(2, 31, 'z'), line(3, 0, 'w')] };
    const plan = planNarration(data, film(10));
    assert.deepEqual(
      plan?.lines.map((kept) => kept.audio),
      ['a', 'b'],
    );
    assert.equal(plan?.duckDb, -12);
  });

  it('takes the narration’s duck within −30…0 dB, and is null with no line', () => {
    assert.equal(planNarration({ lines: [line(1, 1, 'a')], duck: -50 }, film(10))?.duckDb, -30);
    assert.equal(planNarration({ lines: [line(1, 1, 'a')], duck: 3 }, film(10))?.duckDb, 0);
    assert.equal(planNarration({ lines: [line(20, 1, 'a')] }, film(10)), null);
  });

  it('cuts words to 600 units without splitting a surrogate pair', () => {
    assert.equal(clipCaption('a'.repeat(700)).length, 600);
    const emoji = 'a'.repeat(599) + '\u{1F600}' + 'b';
    assert.equal(clipCaption(emoji).length, 599);
  });
});

describe('ducking', () => {
  it('goes down before a line and back up after it', () => {
    const points = duckEnvelope([{ at: play(2), dur: 1 }], -12);
    const low = Math.pow(10, -12 / 20);
    assert.deepEqual(points, [
      { t: 2 - DUCK_ATTACK_SECONDS, v: 1 },
      { t: 2, v: low },
      { t: 3, v: low },
      { t: 3 + DUCK_RELEASE_SECONDS, v: 1 },
    ]);
    assert.equal(sampleEnvelope(points, 0), 1);
    assert.ok(Math.abs(sampleEnvelope(points, 2 - DUCK_ATTACK_SECONDS / 2) - (1 + low) / 2) < 1e-12);
    assert.equal(sampleEnvelope(points, 2.5), low);
    assert.equal(sampleEnvelope(points, 10), 1);
  });

  it('stays down between lines close together', () => {
    const points = duckEnvelope([{ at: play(3.5), dur: 1 }, { at: play(2), dur: 1 }], -12);
    assert.deepEqual(
      points.map((point) => point.t),
      [2 - DUCK_ATTACK_SECONDS, 2, 4.5, 4.5 + DUCK_RELEASE_SECONDS],
    );
  });

  it('is level 1 with no point', () => {
    assert.equal(sampleEnvelope([], 3), 1);
  });
});

describe('captions and the voiceover lane', () => {
  const plan = planNarration({ lines: [line(1, 2, 'a', 'First.'), line(5, 1, 'b', ' '), line(7, 2, 'c', 'Third.')] }, film(10));

  it('shows each line with words from its start for its length, moved by the recut', () => {
    const timeline = segmentTimeline(
      [
        { film: film(0), filmLength: 6, play: play(0), playLength: 3 },
        { film: film(6), filmLength: 4, play: play(3), playLength: 4 },
      ],
      film(10),
    );
    const cues = captionCues(plan, timeline);
    assert.deepEqual(
      cues.map((cue) => [cue.start, cue.end, cue.text]),
      [
        [0.5, 2.5, 'First.'],
        [4, 6, 'Third.'],
      ],
    );
    assert.equal(cueAt(cues, play(1))?.text, 'First.');
    assert.equal(cueAt(cues, play(3)), null);
    assert.equal(cueAt(cues, play(5.5))?.text, 'Third.');
  });

  it('shows none when captions are off', () => {
    assert.ok(plan !== null);
    assert.deepEqual(captionCues({ ...plan, captions: false }, identityTimeline(film(10))), []);
  });

  it('draws the lane with each take’s own length and waveform', async () => {
    assert.ok(plan !== null);
    const decoded = await decodeNarration(plan, new Map([['a', new ArrayBuffer(10)]]), {
      decoder: { decodeAudioData: async () => fakeBuffer(1.5) },
      speechGain: async () => 2,
    });
    assert.ok(decoded !== null);
    const lane = voiceoverLines(decoded, identityTimeline(film(10)));
    assert.deepEqual(
      lane.map((entry) => [entry.audio, entry.at, entry.dur, entry.peaks === null]),
      [
        ['a', 1, 1.5, false],
        ['b', 5, 1, true],
        ['c', 7, 2, true],
      ],
    );
  });
});

describe('decoding takes', () => {
  const limits = DEFAULT_NARRATION_LIMITS;

  it('judges a take by its bytes: big unless a wave, too long, or past the total', () => {
    assert.equal(judgeTakeBytes(300 * 1024, null, 0, limits), 'big');
    assert.equal(judgeTakeBytes(300 * 1024, { seconds: 10, bare: () => new ArrayBuffer(0) }, 0, limits), null);
    assert.equal(judgeTakeBytes(1000, { seconds: 32, bare: () => new ArrayBuffer(0) }, 0, limits), 'long');
    assert.equal(judgeTakeBytes(1000, { seconds: 10, bare: () => new ArrayBuffer(0) }, 35_995, limits), 'total');
    assert.equal(judgeTakeBytes(1000, null, 36_000, limits), 'total');
  });

  it('judges a decoded take by its length', () => {
    assert.equal(judgeTakeSeconds(null, 0, limits), 'undecodable');
    assert.equal(judgeTakeSeconds(0, 0, limits), 'undecodable');
    assert.equal(judgeTakeSeconds(31.5, 0, limits), 'long');
    assert.equal(judgeTakeSeconds(10, 35_995, limits), 'total');
    assert.equal(judgeTakeSeconds(10, 0, limits), null);
  });

  it('decodes each named take once and says what it found', async () => {
    const plan = planNarration({ lines: [line(1, 1, 'a'), line(3, 1, 'a'), line(5, 1, 'bad'), line(7, 1, 'missing')] }, film(10));
    assert.ok(plan !== null);
    let decodes = 0;
    const decoder: TakeDecoder = {
      decodeAudioData: async (bytes) => {
        decodes++;
        if (bytes.byteLength === 3) throw new Error('not audio');
        return fakeBuffer(1);
      },
    };
    const assets = new Map([
      ['a', new ArrayBuffer(10)],
      ['bad', new ArrayBuffer(3)],
    ]);
    const decoded = await decodeNarration(plan, assets, { decoder, speechGain: async () => 1.5 });
    assert.ok(decoded !== null);
    assert.equal(decodes, 2);
    assert.deepEqual([...decoded.found], [
      ['a', 1],
      ['bad', 'undecodable'],
    ]);
    assert.equal(decoded.gain, 1.5);
    const speech = placeSpeech(decoded, identityTimeline(film(10)));
    assert.deepEqual(
      speech?.clips.map((clip) => clip.at),
      [1, 3],
    );
    assert.equal(speech?.gain, 1.5);
    assert.equal(speech?.duck.length, 8);
  });

  it('decodes a plain wave from its bare samples', async () => {
    const take = fakeBuffer(0.5, 8000);
    const wave = encodePcmWave(take);
    const plan = planNarration({ lines: [line(0, 0.5, 'w')] }, film(2));
    assert.ok(plan !== null);
    let given = 0;
    const decoded = await decodeNarration(plan, new Map([['w', wave.buffer]]), {
      decoder: {
        decodeAudioData: async (bytes) => {
          given = bytes.byteLength;
          return take;
        },
      },
      speechGain: async () => 1,
    });
    assert.equal(given, wave.byteLength);
    assert.equal(decoded?.found.get('w'), 0.5);
    assert.ok(parsePcmWave(wave.buffer) !== null);
  });

  it('stops when the film moves on', async () => {
    const plan = planNarration({ lines: [line(0, 1, 'a')] }, film(2));
    assert.ok(plan !== null);
    const decoded = await decodeNarration(plan, new Map([['a', new ArrayBuffer(4)]]), { isCurrent: () => false, decoder: null });
    assert.equal(decoded, null);
  });

  it('speaks no line whose start is cut out', async () => {
    const plan = planNarration({ lines: [line(1, 1, 'a'), line(5, 1, 'a')] }, film(10));
    assert.ok(plan !== null);
    const decoded = await decodeNarration(plan, new Map([['a', new ArrayBuffer(4)]]), {
      decoder: { decodeAudioData: async () => fakeBuffer(1) },
      speechGain: async () => 1,
    });
    assert.ok(decoded !== null);
    const timeline = segmentTimeline(
      [
        { film: film(0), filmLength: 4, play: play(0), playLength: 4 },
        { film: film(6), filmLength: 4, play: play(4), playLength: 4 },
      ],
      film(10),
    );
    assert.deepEqual(
      placeSpeech(decoded, timeline)?.clips.map((clip) => clip.at),
      [1],
    );
  });
});

/** Enough of an AudioBuffer for a clip's sound: its channels at a rate, as a cut copies them. */
function channelBuffer(channels: readonly Float32Array[], sampleRate: number): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  const fake = {
    duration: length / sampleRate,
    length,
    sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (index: number) => channels[index]!,
  };
  return fake as unknown as AudioBuffer;
}

/** A decoder for clips: a clip decodes to `source`, anything else to `other`, and a cut is copied into a fresh buffer. */
function clipDecoder(source: AudioBuffer, other: AudioBuffer = source): TakeDecoder & { decodes: number } {
  const decoder = {
    decodes: 0,
    decodeAudioData: async (bytes: ArrayBuffer) => {
      decoder.decodes++;
      return isClipContainer(bytes) ? source : other;
    },
    createBuffer: (count: number, length: number, sampleRate: number) =>
      channelBuffer(
        Array.from({ length: count }, () => new Float32Array(length)),
        sampleRate,
      ),
  };
  return decoder;
}

/** The first bytes of an MP4: a box whose type is `ftyp`. */
function mp4Bytes(size = 64): ArrayBuffer {
  const bytes = new Uint8Array(size);
  bytes.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  return bytes.buffer;
}

describe('a clip’s own sound', () => {
  const limits = DEFAULT_NARRATION_LIMITS;
  const cut = (at: number, dur: number, audio: string, from: number, text = 'Words.'): NarrationLine => ({ at: film(at), dur, audio, text, from });

  it('keeps a line’s from when it is a second of its asset, and drops the line when it is not', () => {
    const plan = planNarration(
      {
        lines: [
          cut(1, 2, 'c-tao', 18.05),
          cut(4, 2, 'c-tao', -1),
          cut(5, 2, 'c-tao', Number.NaN),
          { ...line(6, 1, 'vo-1'), from: '2' as unknown as number },
          line(8, 1, 'vo-1'),
        ],
      },
      film(10),
    );
    assert.deepEqual(
      plan?.lines.map((kept) => [kept.at, kept.audio, kept.from]),
      [
        [1, 'c-tao', 18.05],
        [8, 'vo-1', undefined],
      ],
    );
    assert.ok(plan !== null && !('from' in plan.lines[1]!));
  });

  it('names a take by its asset alone, a cut by its asset, start and length', () => {
    assert.equal(takeKey(line(1, 2, 'vo-1')), 'vo-1');
    assert.equal(takeKey(cut(1, 2, 'c-tao', 18.05)), 'c-tao@18.05+2');
    assert.notEqual(takeKey(cut(1, 2, 'c-tao', 0)), takeKey(cut(1, 3, 'c-tao', 0)));
  });

  it('tells a clip by its bytes: an MP4 or a WebM', () => {
    assert.ok(isClipContainer(mp4Bytes()));
    assert.ok(isClipContainer(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]).buffer));
    assert.ok(!isClipContainer(encodePcmWave(fakeBuffer(0.1, 8000)).buffer));
    assert.ok(!isClipContainer(new ArrayBuffer(4)));
  });

  it('judges what lines cut from: a clip by the clip size, a recording as a take, either by the clip length', () => {
    assert.equal(judgeSourceBytes(limits.maxClipKib * 1024, true, null, limits), null);
    assert.equal(judgeSourceBytes(limits.maxClipKib * 1024 + 1, true, null, limits), 'big');
    assert.equal(judgeSourceBytes(300 * 1024, false, null, limits), 'big');
    assert.equal(judgeSourceBytes(1000, false, { seconds: limits.maxClipSeconds + 1, bare: () => new ArrayBuffer(0) }, limits), 'long');
    assert.equal(judgeSourceSeconds(null, limits), 'undecodable');
    assert.equal(judgeSourceSeconds(0, limits), 'undecodable');
    assert.equal(judgeSourceSeconds(limits.maxClipSeconds + 0.5, limits), 'long');
    assert.equal(judgeSourceSeconds(120, limits), null);
  });

  it('judges a cut: within its asset, and its seconds (to the asset’s end) within the total', () => {
    assert.equal(judgeCut(60, 2, 60, 0, limits), 'past');
    assert.equal(judgeCut(10, 2, 60, 0, limits), null);
    assert.equal(judgeCut(10, 2, 60, limits.maxSpeechSeconds - 1, limits), 'total');
    // Only the second left in the clip counts.
    assert.equal(judgeCut(59, 5, 60, limits.maxSpeechSeconds - 1, limits), null);
  });

  it('cuts the samples from a second for a length, fading its edges, to the end at most', () => {
    const rate = 1000;
    const channels = [new Float32Array(3000).fill(1), new Float32Array(3000).fill(-1)];
    const [left, right] = cutSamples(channels, rate, 1, 0.5);
    const fade = Math.round(CUT_FADE_SECONDS * rate);
    assert.equal(left?.length, 500);
    assert.equal(right?.length, 500);
    assert.equal(left?.[0], 0);
    assert.equal(left?.[fade], 1);
    assert.equal(left?.[250], 1);
    assert.equal(right?.[250], -1);
    assert.ok((left?.[499] ?? 1) < 1);
    assert.equal(channels[0]?.[1000], 1, 'the clip itself is untouched');
    assert.equal(cutSamples(channels, rate, 2.8, 1)[0]?.length, 200);
    assert.equal(cutSamples(channels, rate, 3, 1)[0]?.length, 0);
  });

  it('decodes a clip once for all its cuts, plays each at its line, and ducks the score under them', async () => {
    const rate = 100;
    const samples = new Float32Array(60 * rate).map((_unused, index) => index / (60 * rate));
    const decoder = clipDecoder(channelBuffer([samples], rate), fakeBuffer(1, 8000));
    const plan = planNarration(
      { lines: [cut(1, 2, 'c-tao', 18), line(4, 1, 'vo-1'), cut(6, 1.5, 'c-tao', 30), cut(9, 0.5, 'c-tao', 18)] },
      film(10),
    );
    assert.ok(plan !== null);
    const assets = new Map([
      ['c-tao', mp4Bytes()],
      ['vo-1', encodePcmWave(fakeBuffer(1, 8000)).buffer],
    ]);
    let measured: readonly AudioBuffer[] = [];
    const decoded = await decodeNarration(plan, assets, {
      decoder,
      speechGain: async (takes) => {
        measured = takes;
        return 1.25;
      },
    });
    assert.ok(decoded !== null);
    assert.equal(decoder.decodes, 2);
    assert.deepEqual([...decoded.found], [
      ['c-tao@18+2', 2],
      ['c-tao@30+1.5', 1.5],
      ['c-tao@18+0.5', 0.5],
      ['vo-1', 1],
    ]);
    // The cut from second 18 holds the clip's samples from there, its first faded in.
    const first = decoded.takes.get('c-tao@18+2')?.getChannelData(0);
    assert.equal(first?.[0], 0);
    assert.equal(first?.[100], samples[18 * rate + 100]);
    assert.equal(measured.length, 4, 'the cuts are brought to the loudness target with the takes');
    const timeline = identityTimeline(film(10));
    const speech = placeSpeech(decoded, timeline);
    assert.deepEqual(
      speech?.clips.map((clip) => [clip.at, clip.buffer.duration]),
      [
        [1, 2],
        [4, 1],
        [6, 1.5],
        [9, 0.5],
      ],
    );
    assert.equal(speech?.gain, 1.25);
    const low = Math.pow(10, -12 / 20);
    assert.equal(sampleEnvelope(speech?.duck ?? [], 2), low);
    assert.equal(sampleEnvelope(speech?.duck ?? [], 6.5), low);
    assert.equal(sampleEnvelope(speech?.duck ?? [], 8.6), 1);
    const lane = voiceoverLines(decoded, timeline);
    assert.deepEqual(
      lane.map((entry) => [entry.audio, entry.dur, entry.peaks !== null]),
      [
        ['c-tao', 2, true],
        ['vo-1', 1, true],
        ['c-tao', 1.5, true],
        ['c-tao', 0.5, true],
      ],
    );
  });

  it('leaves silent a clip named with no from, a cut past its end, and a clip too big, long or with no sound', async () => {
    const rate = 100;
    const source = channelBuffer([new Float32Array(20 * rate).fill(0.5)], rate);
    const plan = planNarration({ lines: [line(1, 1, 'whole'), cut(3, 1, 'short', 25), cut(5, 1, 'short', 2)] }, film(10));
    assert.ok(plan !== null);
    const decoded = await decodeNarration(
      plan,
      new Map([
        ['whole', mp4Bytes()],
        ['short', mp4Bytes()],
      ]),
      { decoder: clipDecoder(source), speechGain: async () => 1 },
    );
    assert.deepEqual([...(decoded?.found ?? [])], [
      ['whole', 'clip'],
      ['short@25+1', 'past'],
      ['short@2+1', 1],
    ]);

    const big = planNarration({ lines: [cut(1, 1, 'big', 0)] }, film(10));
    assert.ok(big !== null);
    const bigDecoder = clipDecoder(source);
    const tooBig = await decodeNarration(big, new Map([['big', mp4Bytes(limits.maxClipKib * 1024 + 8)]]), {
      decoder: bigDecoder,
      speechGain: async () => 1,
    });
    assert.equal(bigDecoder.decodes, 0, 'a clip over the size limit is never decoded');
    assert.deepEqual([...(tooBig?.found ?? [])], [
      ['big', 'big'],
      ['big@0+1', 'big'],
    ]);

    const long = await decodeNarration(big, new Map([['big', mp4Bytes()]]), {
      decoder: clipDecoder(channelBuffer([new Float32Array((limits.maxClipSeconds + 1) * 10)], 10)),
      speechGain: async () => 1,
    });
    assert.equal(long?.found.get('big@0+1'), 'long');

    const mute = await decodeNarration(big, new Map([['big', mp4Bytes()]]), {
      decoder: { decodeAudioData: async () => Promise.reject(new Error('no audio track')) },
      speechGain: async () => 1,
    });
    assert.equal(mute?.found.get('big@0+1'), 'undecodable');
    assert.equal(mute?.takes.size, 0);
  });

  it('counts cuts toward the narration’s total', async () => {
    const rate = 10;
    const tight = { ...DEFAULT_NARRATION_LIMITS, maxSpeechSeconds: 300 };
    const source = channelBuffer([new Float32Array(500 * rate).fill(0.5)], rate);
    const lines = Array.from({ length: 11 }, (_unused, index) => cut(index * 0.5, 29, 'long-clip', index * 30));
    const plan = planNarration({ lines }, film(10));
    assert.ok(plan !== null);
    const decoded = await decodeNarration(plan, new Map([['long-clip', mp4Bytes()]]), { decoder: clipDecoder(source), speechGain: async () => 1, limits: tight });
    assert.ok(decoded !== null);
    const said = [...decoded.found.values()];
    assert.equal(said.filter((value) => value === 29).length, 10);
    assert.deepEqual(said.slice(10), ['total']);
  });
});

describe('waveform peaks', () => {
  it('draws 60 bars a second, scaled to the loudest, never under the floor', () => {
    const samples = new Float32Array(1000);
    samples[10] = 0.5;
    samples[600] = 1;
    const peaks = voicePeaks(samples, 0.5);
    assert.equal(peaks.length, 30);
    assert.equal(Math.max(...peaks), 1);
    assert.ok(peaks.every((peak) => peak >= 0.08));
    assert.equal(peaks[0], Number((0.5 ** 0.6).toFixed(3)));
  });

  it('draws at least 8 bars, all at the floor for silence', () => {
    assert.deepEqual(voicePeaks(new Float32Array(100), 0.01), new Array(8).fill(0.08));
  });
});
