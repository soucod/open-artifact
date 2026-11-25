import { buildClock } from '@open-artifact/motion-core';
import type { FilmClock, NarrationData, PlaySeconds, ScoreData } from '@open-artifact/motion-core';
import { FilmSoundPlayer, decodeNarration, identityTimeline, planNarration } from '@open-artifact/motion-audio';
import { OFFLINE_AUDIO_GLOBAL, OFFLINE_DATA_ID, fromBase64, readOfflineData } from '@open-artifact/motion-stage';
import type { NarrationReport, PlayedScore, ScorePlayer, ScorePlayerFactory } from '@open-artifact/motion-stage';

// The standalone page plays the film as recorded in play time, unretimed: its clock has no parts, so play time and film
// time are the same moments.
const asPlayed: FilmClock = buildClock([]);

function scoreData(score: PlayedScore): ScoreData {
  return { ...score, events: score.events.map((event) => ({ ...event, t: asPlayed.toFilm(event.t) })) };
}

function narrationData(narration: NarrationReport): NarrationData {
  return {
    lines: narration.lines.map((line) => ({
      at: asPlayed.toFilm(line.at),
      dur: line.dur,
      text: line.text,
      audio: line.audio,
      ...(line.from !== undefined ? { from: line.from } : {}),
    })),
    ...(narration.duck !== null ? { duck: narration.duck } : {}),
  };
}

const BASE64_URL = /^data:[^;,]+;base64,/;

/** An asset's bytes: those it carries, or those of a `data:` URL it streams from (a clip); null for any other URL. */
function assetBytes(asset: { bytes?: ArrayBuffer; url?: string }): ArrayBuffer | null {
  if (asset.bytes !== undefined) return asset.bytes;
  const prefix = asset.url === undefined ? null : BASE64_URL.exec(asset.url);
  if (prefix === null || asset.url === undefined) return null;
  try {
    return fromBase64(asset.url.slice(prefix[0].length));
  } catch {
    return null;
  }
}

/** The bytes of the assets the lines name: takes, and clips whose sound lines cut from. */
function takeBytes(names: ReadonlySet<string>): Map<string, ArrayBuffer> {
  const takes = new Map<string, ArrayBuffer>();
  const text = document.getElementById(OFFLINE_DATA_ID)?.textContent ?? null;
  if (text === null) return takes;
  const film = readOfflineData(text);
  if (typeof film === 'string') return takes;
  for (const asset of film.assets) {
    if (!names.has(asset.name) || !(asset.mime.startsWith('audio/') || asset.mime.startsWith('video/'))) continue;
    const bytes = assetBytes(asset);
    if (bytes !== null) takes.set(asset.name, bytes);
  }
  return takes;
}

function makeScorePlayer(): ScorePlayer {
  const player = new FilmSoundPlayer();
  return {
    async prepare(score, narration, duration) {
      const length = asPlayed.toFilm(duration);
      const plan = narration === null ? null : planNarration(narrationData(narration), length);
      const decoded = plan === null ? null : await decodeNarration(plan, takeBytes(new Set(plan.lines.map((line) => line.audio))));
      player.load({ score: score === null ? null : scoreData(score), narration: decoded, timeline: identityTimeline(length) });
    },
    start(t) {
      player.setMuted(false);
      player.play(t);
    },
    stop() {
      player.pause();
    },
    now(): PlaySeconds | null {
      return player.state.playing ? player.now() : null;
    },
  };
}

const factory: ScorePlayerFactory = makeScorePlayer;
Reflect.set(window, OFFLINE_AUDIO_GLOBAL, factory);
