import { measureSpeechGain } from '../offline.ts';
import { parsePcmWave } from '../wave.ts';
import type { PcmWave } from '../wave.ts';
import { DEFAULT_NARRATION_LIMITS } from './limits.ts';
import type { NarrationLimits } from './limits.ts';
import { voicePeaks } from './peaks.ts';
import { takeKey } from './plan.ts';
import type { NarrationPlan } from './plan.ts';
import type { DecodedNarration, TakeIssue } from './speech.ts';

/** What turns a take's bytes into samples, and makes the buffer a cut is copied into: any audio context. */
export interface TakeDecoder {
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer>;
  /** Without it, a cut is made with the AudioBuffer constructor, where there is one. */
  createBuffer?(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
}

export interface DecodeOptions {
  readonly limits?: NarrationLimits;
  /** False once the film has moved on, so a stale decode stops early. */
  readonly isCurrent?: () => boolean;
  readonly decoder?: TakeDecoder | null;
  /** How the takes' loudness gain is found; by default they are rendered through the mix and measured. */
  readonly speechGain?: (takes: readonly AudioBuffer[], targetLufs: number) => Promise<number>;
}

const KIB = 1024;
/** A take may run this much past a line's limit before it is too long. */
const LINE_SLACK_SECONDS = 1;
/** A cut fades in and out over this long, so it starts and ends without a click. */
export const CUT_FADE_SECONDS = 0.005;

/**
 * Judges a take by its bytes before decoding: too big unless it is a plain wave within the wave limit, too long when a
 * wave says so, or past the narration's total.
 */
export function judgeTakeBytes(byteLength: number, wave: PcmWave | null, totalSeconds: number, limits: NarrationLimits): TakeIssue | null {
  if (wave === null && byteLength > limits.maxTakeKib * KIB) return 'big';
  if (wave !== null && wave.seconds > limits.maxLineSeconds + LINE_SLACK_SECONDS) return 'long';
  if (totalSeconds + (wave?.seconds ?? 0) > limits.maxSpeechSeconds || totalSeconds >= limits.maxSpeechSeconds) return 'total';
  return null;
}

/** Judges a decoded take by its length. */
export function judgeTakeSeconds(seconds: number | null, totalSeconds: number, limits: NarrationLimits): TakeIssue | null {
  if (seconds === null || seconds === 0) return 'undecodable';
  if (seconds > limits.maxLineSeconds + LINE_SLACK_SECONDS) return 'long';
  if (totalSeconds + seconds > limits.maxSpeechSeconds) return 'total';
  return null;
}

/** True for the bytes of a video file the player reads: an MP4 (or QuickTime) or a WebM. */
export function isClipContainer(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 8) return false;
  const head = new Uint8Array(bytes, 0, 8);
  const webm = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  const mp4 = String.fromCharCode(head[4]!, head[5]!, head[6]!, head[7]!) === 'ftyp';
  return webm || mp4;
}

/**
 * Judges what lines cut from by its bytes before decoding: a clip by the clip limit, a recording as a take is judged;
 * a wave longer than a clip may be is too long.
 */
export function judgeSourceBytes(byteLength: number, clip: boolean, wave: PcmWave | null, limits: NarrationLimits): TakeIssue | null {
  if (clip) return byteLength > limits.maxClipKib * KIB ? 'big' : null;
  if (wave === null && byteLength > limits.maxTakeKib * KIB) return 'big';
  if (wave !== null && wave.seconds > limits.maxClipSeconds) return 'long';
  return null;
}

/** Judges what lines cut from by its decoded length: it has sound, and is no longer than a clip may be. */
export function judgeSourceSeconds(seconds: number | null, limits: NarrationLimits): TakeIssue | null {
  if (seconds === null || seconds === 0) return 'undecodable';
  return seconds > limits.maxClipSeconds ? 'long' : null;
}

/** Judges a cut: it starts before its asset ends, and its seconds (to the asset's end at most) fit the narration's total. */
export function judgeCut(from: number, dur: number, sourceSeconds: number, totalSeconds: number, limits: NarrationLimits): TakeIssue | null {
  if (from >= sourceSeconds) return 'past';
  return totalSeconds + Math.min(dur, sourceSeconds - from) > limits.maxSpeechSeconds ? 'total' : null;
}

/**
 * The samples of `channels` from second `from` for `dur` seconds (to their end at most), faded in and out over
 * CUT_FADE_SECONDS. Empty when the cut starts at or past their end.
 */
export function cutSamples(channels: readonly Float32Array[], sampleRate: number, from: number, dur: number): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  const start = Math.min(length, Math.round(from * sampleRate));
  const end = Math.min(length, Math.round((from + dur) * sampleRate));
  const fade = Math.max(1, Math.round(CUT_FADE_SECONDS * sampleRate));
  return channels.map((channel) => {
    const cut = channel.slice(start, end);
    const ramp = Math.min(fade, Math.floor(cut.length / 2));
    for (let i = 0; i < ramp; i++) {
      const level = i / ramp;
      cut[i]! *= level;
      cut[cut.length - 1 - i]! *= level;
    }
    return cut;
  });
}

function defaultDecoder(): TakeDecoder | null {
  return typeof OfflineAudioContext === 'undefined' ? null : new OfflineAudioContext(1, 1, 48000);
}

/** A cut of `source` as a buffer of its own, or null when none can be made. */
function makeCut(decoder: TakeDecoder, source: AudioBuffer, from: number, dur: number): AudioBuffer | null {
  const channels = Array.from({ length: source.numberOfChannels }, (_unused, index) => source.getChannelData(index));
  const samples = cutSamples(channels, source.sampleRate, from, dur);
  const length = samples[0]?.length ?? 0;
  if (length === 0) return null;
  const buffer =
    decoder.createBuffer?.(samples.length, length, source.sampleRate) ??
    (typeof AudioBuffer === 'undefined' ? null : new AudioBuffer({ numberOfChannels: samples.length, length, sampleRate: source.sampleRate }));
  if (buffer === null) return null;
  samples.forEach((channel, index) => buffer.getChannelData(index).set(channel));
  return buffer;
}

async function decodeBytes(decoder: TakeDecoder | null, bytes: ArrayBuffer, wave: PcmWave | null): Promise<AudioBuffer | null> {
  if (decoder === null) return null;
  const buffer = await decoder.decodeAudioData(wave?.bare() ?? bytes.slice(0)).catch((): null => null);
  return buffer === null || buffer.length === 0 ? null : buffer;
}

/**
 * Decodes each take the lines name once, within the limits. A line with `from` plays a cut of its asset: a clip's own
 * sound (a video asset) or a longer recording, decoded once for all its cuts and let go once they are made. Cuts count
 * toward the narration's total as takes do. Null when the film moved on meanwhile.
 */
export async function decodeNarration(
  plan: NarrationPlan,
  assets: ReadonlyMap<string, ArrayBuffer>,
  options: DecodeOptions = {},
): Promise<DecodedNarration | null> {
  const limits = options.limits ?? DEFAULT_NARRATION_LIMITS;
  const isCurrent = options.isCurrent ?? (() => true);
  const decoder = options.decoder === undefined ? defaultDecoder() : options.decoder;
  const takes = new Map<string, AudioBuffer>();
  const found = new Map<string, TakeIssue | number>();
  const peaks = new Map<string, readonly number[]>();
  let totalSeconds = 0;
  const keep = (key: string, buffer: AudioBuffer): void => {
    found.set(key, buffer.duration);
    totalSeconds += buffer.duration;
    takes.set(key, buffer);
    peaks.set(key, voicePeaks(buffer.getChannelData(0), buffer.duration));
  };
  for (const name of new Set(plan.lines.map((line) => line.audio))) {
    const bytes = assets.get(name);
    if (bytes === undefined) continue;
    if (!isCurrent()) return null;
    const lines = plan.lines.filter((line) => line.audio === name);
    const clip = isClipContainer(bytes);
    // A plain 16-bit wave is read by its chunks, so its length is known before decoding and it may be larger than an mp3.
    const wave = !clip && bytes.byteLength <= Math.max(limits.maxTakeKib, limits.maxWavKib) * KIB ? parsePcmWave(bytes) : null;
    if (lines.some((line) => line.from === undefined)) {
      // A clip is heard only as cuts: its whole sound is no take.
      const before = clip ? 'clip' : judgeTakeBytes(bytes.byteLength, wave, totalSeconds, limits);
      const buffer = before !== null ? null : await decodeBytes(decoder, bytes, wave);
      const issue = before ?? judgeTakeSeconds(buffer?.duration ?? null, totalSeconds, limits);
      if (issue !== null || buffer === null) found.set(name, issue ?? 'undecodable');
      else keep(name, buffer);
    }
    const cuts = lines.filter((line) => line.from !== undefined);
    if (cuts.length === 0) continue;
    if (!isCurrent()) return null;
    const before = judgeSourceBytes(bytes.byteLength, clip, wave, limits);
    const source = before !== null || decoder === null ? null : await decodeBytes(decoder, bytes, wave);
    const sourceIssue = before ?? judgeSourceSeconds(source?.duration ?? null, limits);
    if (sourceIssue !== null && !found.has(name)) found.set(name, sourceIssue);
    for (const line of cuts) {
      const key = takeKey(line);
      if (found.has(key)) continue;
      const from = line.from ?? 0;
      const issue = sourceIssue ?? (source === null ? 'undecodable' : judgeCut(from, line.dur, source.duration, totalSeconds, limits));
      const cut = issue === null && source !== null && decoder !== null ? makeCut(decoder, source, from, line.dur) : null;
      if (cut === null) found.set(key, issue ?? 'undecodable');
      else keep(key, cut);
    }
  }
  if (!isCurrent()) return null;
  const measure = options.speechGain ?? ((buffers: readonly AudioBuffer[], target: number) => measureSpeechGain(buffers, target));
  const gain = takes.size === 0 ? 1 : await measure([...takes.values()], limits.loudness);
  if (!isCurrent()) return null;
  return { plan, takes, found, peaks, gain };
}
