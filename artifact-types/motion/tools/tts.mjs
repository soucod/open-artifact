#!/usr/bin/env node
/**
 * Text to speech for a film's voiceover: turns lines of text into audio clips and reports each clip's length, through
 * Speech SDK (@speech-sdk/core, https://github.com/Jellypod-Inc/speech-sdk), which speaks to OpenAI, ElevenLabs,
 * Google, Cartesia, MiniMax and a dozen more providers through one call.
 *
 *   node tts.mjs --model openai/gpt-4o-mini-tts --voice alloy --text "The furnace is lit before dawn." --out vo-1.wav
 *   node tts.mjs --model elevenlabs/eleven_multilingual_v2 --voice <id> --lines lines.txt --out clips/ --timestamps
 *
 * The API key, first one found:
 *   --api-key-env <NAME>    the environment variable that holds it
 *   --api-key-file <path>   a file that holds nothing else (`-`: read it from stdin)
 *   --api-key <key>         the key itself; it shows in the process list and the shell history, so prefer the others
 *   TTS_API_KEY             in the environment
 *   the provider's own      OPENAI_API_KEY, ELEVENLABS_API_KEY, GOOGLE_API_KEY, … (the SDK reads it)
 * `--env-file <path>` loads KEY=value lines into the environment first. The key is never printed or written.
 *
 * What it prints: progress on stderr; on stdout one JSON object,
 *   { model, voice, format, mime, clips: [{ n, name, file, text, dur, bytes, words?, wordTimes?, warnings? }], failed: [...] }
 * `dur` is the clip's seconds, `mime` what the film's asset document takes, `words` the second each word starts and
 * ends (with --timestamps). With --lines the same object is also kept as tts.json in the output folder.
 * Exit code: 0 all recorded, 1 a clip failed, 2 the command was wrong.
 *
 * Two more modes, neither of which records: `--check` prints which key variables the environment holds (names only)
 * and whether the SDK is installed; `--models <provider>` prints that provider's models and what each can do.
 *
 * The SDK is not bundled. It is looked for in --sdk <dir> (or OPEN_ARTIFACT_TTS_SDK), then from the working
 * directory, then in a cache folder, where the first run installs the pinned version with npm (--no-install forbids
 * that). Needs Node 22 or later.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SDK = '@speech-sdk/core';
const SDK_VERSION = '0.38.0';
const MOST_LINES = 100;

/** Provider prefix → [its factory in @speech-sdk/core/providers, the environment variable the SDK reads its key from]. */
const PROVIDERS = {
  openai: ['createOpenAI', 'OPENAI_API_KEY'],
  elevenlabs: ['createElevenLabs', 'ELEVENLABS_API_KEY'],
  google: ['createGoogle', 'GOOGLE_API_KEY'],
  cartesia: ['createCartesia', 'CARTESIA_API_KEY'],
  deepgram: ['createDeepgram', 'DEEPGRAM_API_KEY'],
  heygen: ['createHeyGen', 'HEYGEN_API_KEY'],
  hume: ['createHume', 'HUME_API_KEY'],
  inworld: ['createInworld', 'INWORLD_API_KEY'],
  'fish-audio': ['createFishAudio', 'FISH_AUDIO_API_KEY'],
  gradium: ['createGradium', 'GRADIUM_API_KEY'],
  murf: ['createMurf', 'MURF_API_KEY'],
  resemble: ['createResemble', 'RESEMBLE_API_KEY'],
  'fal-ai': ['createFal', 'FAL_API_KEY'],
  mistral: ['createMistral', 'MISTRAL_API_KEY'],
  xai: ['createXai', 'XAI_API_KEY'],
  minimax: ['createMiniMax', 'MINIMAX_API_KEY'],
  speechify: ['createSpeechify', 'SPEECHIFY_API_KEY'],
  'smallest-ai': ['createSmallestAI', 'SMALLEST_API_KEY'],
};

const HELP = `Text to speech for a film's voiceover, through Speech SDK (${SDK}).

  node tts.mjs --model <provider/model> --voice <id> --text "<words>" [--out vo-1.wav]
  node tts.mjs --model <provider/model> --voice <id> --lines <file> [--out <folder>]

What to say
  --text <words>          one clip ("-": the words on stdin)
  --lines <file>          a clip per line ("-": stdin). A text file: one line a clip, blank lines and lines that
                          begin with # passed over. A .json file: an array of strings, or of
                          { "text": caption, "say"?: what the voice is sent, "name"?: the clip's name }
  --only <n,n>            with --lines: record only these lines (counted from 1)

How to say it
  --model <provider/model>   openai/gpt-4o-mini-tts, elevenlabs/eleven_multilingual_v2, google/…; a bare provider
                             (openai) takes its default model. Also TTS_MODEL in the environment
  --voice <id>               the provider's voice id. Also TTS_VOICE
  --instructions <words>     the manner (tone, pace, situation), on models that take one. Never the words
  --options <json>           provider options passed through as they are, e.g. '{"seed":7}'
  --volume <dBFS>            bring every clip to this loudness, e.g. -20

What comes out
  --out <path>            with --text the file (default tts.wav); with --lines the folder (default .)
  --prefix <p>            with --lines: clips are <p>1, <p>2, … (default vo-)
  --format wav|mp3        default: --out's extension, else wav
  --timestamps            the second each word starts and ends, from models that give word times (ElevenLabs,
                          Cartesia, Hume, Inworld, Murf, Resemble); others record without, with a warning

The API key (first one found; it is never printed)
  --api-key-env <NAME>    the environment variable that holds it
  --api-key-file <path>   a file that holds only the key ("-": stdin)
  --api-key <key>         the key itself (visible in the process list: prefer the two above)
  TTS_API_KEY, or the provider's own variable (OPENAI_API_KEY, ELEVENLABS_API_KEY, GOOGLE_API_KEY, …)
  --env-file <path>       load KEY=value lines into the environment first
  --base-url <url>        another endpoint for the provider (a proxy, a compatible server)

Before recording
  --check                 which keys the environment holds, by variable name only, and whether the SDK is installed
  --models <provider>     that provider's models: id, features (instructions, timestamps, …), languages

The SDK
  --sdk <dir>             a folder that has ${SDK} installed (also OPEN_ARTIFACT_TTS_SDK)
  --no-install            never install it; fail if it isn't found

Prints one JSON object on stdout: { model, voice, format, mime, clips: [{ n, name, file, text, dur, … }], failed }.
`;

class UsageError extends Error {}

const TAKES_VALUE = new Set([
  'model', 'voice', 'text', 'lines', 'out', 'prefix', 'only', 'format', 'instructions', 'options', 'volume',
  'api-key', 'api-key-env', 'api-key-file', 'env-file', 'base-url', 'sdk', 'models',
]);
const FLAGS = new Set(['timestamps', 'no-install', 'help', 'json', 'check']);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h') {
      args.help = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new UsageError('unexpected "' + arg + '" (words to say go after --text, in quotes)');
    const eq = arg.indexOf('=');
    const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    if (FLAGS.has(name)) {
      args[name] = true;
    } else if (TAKES_VALUE.has(name)) {
      const value = eq < 0 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined) throw new UsageError('--' + name + ' needs a value');
      args[name] = value;
    } else throw new UsageError('unknown option --' + name);
  }
  return args;
}

let stdinTaken = null;
function readStdin(what) {
  if (stdinTaken) throw new UsageError('stdin is already read for ' + stdinTaken + ', so ' + what + ' needs a file');
  stdinTaken = what;
  return readFileSync(0, 'utf8');
}

/** The key, or undefined to let the SDK read the provider's own variable. */
function apiKeyOf(args) {
  if (args['api-key-env']) {
    const value = process.env[args['api-key-env']];
    if (!value) throw new UsageError('the environment variable ' + args['api-key-env'] + ' is not set or is empty');
    return value.trim();
  }
  if (args['api-key-file']) {
    const from = args['api-key-file'];
    const value = (from === '-' ? readStdin('the API key') : readFileSync(resolve(from), 'utf8')).trim();
    if (!value) throw new UsageError('no key in ' + (from === '-' ? 'stdin' : from));
    return value.split(/\r?\n/)[0].trim();
  }
  if (args['api-key']) return args['api-key'].trim();
  if (process.env.TTS_API_KEY) return process.env.TTS_API_KEY.trim();
  return undefined;
}

/** The lines to record: [{ n, name, text, say }]. `text` is the caption, `say` what the voice is sent. */
function linesOf(args) {
  const prefix = args.prefix ?? 'vo-';
  if (args.text !== undefined && args.lines !== undefined) throw new UsageError('give --text or --lines, not both');
  if (args.text !== undefined) {
    const text = (args.text === '-' ? readStdin('the text') : args.text).trim();
    if (!text) throw new UsageError('--text is empty');
    return [{ n: 1, name: null, text, say: text }];
  }
  if (args.lines === undefined) throw new UsageError('nothing to say: give --text "<words>" or --lines <file>');
  const raw = args.lines === '-' ? readStdin('the lines') : readFileSync(resolve(args.lines), 'utf8');
  let entries;
  if (args.lines !== '-' && extname(args.lines).toLowerCase() === '.json') {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new UsageError(args.lines + ' is not JSON: ' + error.message);
    }
    if (!Array.isArray(parsed)) throw new UsageError(args.lines + ' must hold a JSON array');
    entries = parsed.map((entry, i) => {
      const line = typeof entry === 'string' ? { text: entry } : entry;
      if (!line || typeof line.text !== 'string' || !line.text.trim()) throw new UsageError(args.lines + ': entry ' + (i + 1) + ' has no "text"');
      return line;
    });
  } else {
    entries = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((text) => ({ text }));
  }
  if (!entries.length) throw new UsageError('no lines in ' + (args.lines === '-' ? 'stdin' : args.lines));
  if (entries.length > MOST_LINES) console.error('note: ' + entries.length + ' lines; a film takes ' + MOST_LINES + ' at most');
  const all = entries.map((line, i) => {
    const name = typeof line.name === 'string' && line.name ? line.name : prefix + (i + 1);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/.test(name)) throw new UsageError('"' + name + '" is no name for a clip: letters, digits, _ . - only');
    const text = line.text.trim();
    return { n: i + 1, name, text, say: typeof line.say === 'string' && line.say.trim() ? line.say.trim() : text };
  });
  if (args.only === undefined) return all;
  const wanted = args.only.split(',').map((part) => Number(part.trim()));
  for (const n of wanted) if (!Number.isInteger(n) || n < 1 || n > all.length) throw new UsageError('--only ' + args.only + ': there are lines 1 to ' + all.length);
  return all.filter((line) => wanted.includes(line.n));
}

/** Where @speech-sdk/core is installed: its entry files as URLs. Installs it into the cache on the first run. */
function findSdk(args) {
  const entry = (from) => {
    try {
      const require = createRequire(join(from, 'noop.js'));
      return { core: pathToFileURL(require.resolve(SDK)).href, providers: pathToFileURL(require.resolve(SDK + '/providers')).href };
    } catch {
      return null;
    }
  };
  const given = args.sdk ?? process.env.OPEN_ARTIFACT_TTS_SDK;
  if (given) {
    const found = entry(resolve(given));
    if (!found) throw new UsageError(SDK + ' is not installed in ' + given + ' (npm install --prefix "' + given + '" ' + SDK + '@' + SDK_VERSION + ')');
    return found;
  }
  const local = entry(process.cwd());
  if (local) return local;
  const base = process.env.OPEN_ARTIFACT_TTS_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'open-artifact', 'tts');
  const candidates = [join(base, SDK_VERSION), join(tmpdir(), 'open-artifact-tts', SDK_VERSION)];
  for (const dir of candidates) {
    const found = entry(dir);
    if (found) return found;
  }
  const command = 'npm install --prefix "' + candidates[0] + '" ' + SDK + '@' + SDK_VERSION + ' --ignore-scripts';
  if (args['no-install']) throw new UsageError(SDK + ' is not installed. Install it once (' + command + '), or point --sdk at a folder that has it.');
  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      continue;
    }
    console.error('installing ' + SDK + '@' + SDK_VERSION + ' into ' + dir + ' (once) …');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const done = spawnSync(npm, ['install', '--prefix', dir, SDK + '@' + SDK_VERSION, '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], {
      stdio: ['ignore', 'ignore', 'inherit'],
      shell: process.platform === 'win32',
    });
    const found = done.status === 0 ? entry(dir) : null;
    if (found) return found;
  }
  throw new Error('could not install ' + SDK + ' (no network, or npm is missing). Run it where the network is allowed: ' + command);
}

/** Seconds of a clip, rounded up to a hundredth: from the SDK, else from a WAV's own header. */
function secondsOf(result, bytes, format) {
  const ms = result.metadata?.audioDurationMs;
  if (typeof ms === 'number' && ms > 0) return Math.ceil(ms / 10) / 100;
  if (format !== 'wav' || bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteRate = view.getUint32(28, true);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    const size = view.getUint32(at + 4, true);
    if (id === 'data') return byteRate ? Math.ceil((Math.min(size, bytes.length - at - 8) / byteRate) * 100) / 100 : null;
    at += 8 + size + (size % 2);
  }
  return null;
}

/** A provider's factory from the SDK. */
async function factoryOf(sdk, prefix) {
  const known = PROVIDERS[prefix];
  const providers = await import(sdk.providers);
  if (!known || typeof providers[known[0]] !== 'function') throw new UsageError('no provider "' + prefix + '": ' + Object.keys(PROVIDERS).join(', '));
  return providers[known[0]];
}

/** --check: what is at hand, by name only. Never a key's value. */
function check(args) {
  const held = (name) => typeof process.env[name] === 'string' && process.env[name].trim() !== '';
  const keys = ['TTS_API_KEY', ...Object.values(PROVIDERS).map(([, env]) => env)].filter(held);
  let sdk = 'installed';
  try {
    findSdk({ ...args, 'no-install': true });
  } catch {
    sdk = 'not installed: the first recording installs ' + SDK + '@' + SDK_VERSION + ' with npm';
  }
  const providers = Object.entries(PROVIDERS)
    .filter(([, [, env]]) => held(env))
    .map(([prefix]) => prefix);
  process.stdout.write(JSON.stringify({ keys, providers, model: process.env.TTS_MODEL ?? null, voice: process.env.TTS_VOICE ?? null, sdk }, null, 2) + '\n');
  return 0;
}

/** --models <provider>: what the SDK knows of that provider's models. No request is made. */
async function models(args) {
  const prefix = args.models;
  const make = await factoryOf(findSdk(args), prefix);
  const made = make({ apiKey: '-' })();
  const list = (made.provider?.models ?? []).map((model) => ({
    model: prefix + '/' + model.id,
    ...(model.id === made.modelId ? { default: true } : {}),
    features: model.features ?? [],
    languages: model.languages ?? [],
    ...(model.maxInputChars ? { maxInputChars: model.maxInputChars } : {}),
  }));
  process.stdout.write(JSON.stringify({ provider: prefix, keyVariable: PROVIDERS[prefix][1], models: list }, null, 2) + '\n');
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args['env-file']) {
    if (!existsSync(resolve(args['env-file']))) throw new UsageError('no file ' + args['env-file']);
    process.loadEnvFile(resolve(args['env-file']));
  }
  if (args.check) return check(args);
  if (args.models !== undefined) return models(args);
  const modelName = args.model ?? process.env.TTS_MODEL;
  const voice = args.voice ?? process.env.TTS_VOICE;
  if (!modelName) throw new UsageError('no model: --model <provider/model>, e.g. openai/gpt-4o-mini-tts');
  if (!voice) throw new UsageError('no voice: --voice <id>, one of the provider’s own');
  const lines = linesOf(args);
  const apiKey = apiKeyOf(args);
  const redact = (words) => (apiKey && apiKey.length >= 6 ? String(words).split(apiKey).join('***') : String(words));

  const many = args.lines !== undefined;
  let format = args.format;
  if (!format && !many && args.out && ['.wav', '.mp3'].includes(extname(args.out).toLowerCase())) format = extname(args.out).slice(1).toLowerCase();
  format ??= 'wav';
  if (!['wav', 'mp3'].includes(format)) throw new UsageError('--format is wav or mp3');
  const mime = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
  const folder = resolve(many ? (args.out ?? '.') : dirname(args.out ?? 'tts.' + format));
  if (many && args.out && existsSync(folder) && !statSync(folder).isDirectory()) throw new UsageError('--out is a folder with --lines; ' + args.out + ' is a file');
  const fileOf = (line) => (many ? join(folder, line.name + '.' + format) : resolve(args.out ?? 'tts.' + format));

  let providerOptions;
  if (args.options !== undefined) {
    try {
      providerOptions = JSON.parse(args.options);
    } catch {
      throw new UsageError('--options is not JSON: ' + args.options);
    }
    if (!providerOptions || typeof providerOptions !== 'object' || Array.isArray(providerOptions)) throw new UsageError('--options must be a JSON object');
  }
  let volumeDbfs;
  if (args.volume !== undefined) {
    volumeDbfs = Number(args.volume);
    if (!Number.isFinite(volumeDbfs) || volumeDbfs > 0) throw new UsageError('--volume is a loudness in dBFS, 0 or below, e.g. -20');
  }

  const sdk = findSdk(args);
  const { generateSpeech } = await import(sdk.core);
  let model = modelName;
  if (args['base-url']) {
    const slash = modelName.indexOf('/');
    const prefix = slash < 0 ? modelName : modelName.slice(0, slash);
    const make = await factoryOf(sdk, prefix);
    model = make({ ...(apiKey ? { apiKey } : {}), baseURL: args['base-url'] })(slash < 0 ? undefined : modelName.slice(slash + 1));
  }

  mkdirSync(folder, { recursive: true });
  const clips = [];
  const failed = [];
  for (const line of lines) {
    const label = line.name ?? 'clip';
    const request = {
      model,
      voice,
      text: line.say,
      output: { format },
      ...(apiKey && !args['base-url'] ? { apiKey } : {}),
      ...(args.instructions ? { instructions: args.instructions } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      ...(volumeDbfs !== undefined ? { volumeDbfs } : {}),
    };
    const warnings = [];
    try {
      let result;
      try {
        result = await generateSpeech({ ...request, ...(args.timestamps ? { timestamps: true } : {}) });
      } catch (error) {
        // A model with no word times of its own: record the clip all the same, and say so.
        if (!args.timestamps || !['TimestampKeyMissingError', 'TimestampProviderRequiredError'].includes(error?.name)) throw error;
        warnings.push('no word times: ' + modelName + ' gives none of its own (ElevenLabs, Cartesia, Hume, Inworld, Murf and Resemble models do)');
        result = await generateSpeech(request);
      }
      const bytes = result.audio.uint8Array;
      const file = fileOf(line);
      writeFileSync(file, bytes);
      for (const warning of result.warnings ?? []) warnings.push(redact(typeof warning === 'string' ? warning : (warning?.message ?? JSON.stringify(warning))));
      const clip = { n: line.n, name: line.name ?? undefined, file, text: line.text, ...(line.say !== line.text ? { say: line.say } : {}), dur: secondsOf(result, bytes, format), bytes: bytes.length };
      if (args.timestamps && Array.isArray(result.timestamps) && result.timestamps.length) {
        clip.words = result.timestamps.map((word) => ({ text: word.text, start: Math.round(word.start * 1000) / 1000, end: Math.round(word.end * 1000) / 1000 }));
        if (result.metadata?.timestampsSource) clip.wordTimes = result.metadata.timestampsSource;
      }
      if (warnings.length) clip.warnings = warnings;
      clips.push(clip);
      console.error(label + ': ' + (clip.dur ?? '?') + ' s → ' + file);
    } catch (error) {
      const message = redact(error?.message ?? String(error));
      failed.push({ n: line.n, name: line.name ?? undefined, text: line.text, error: (error?.name && error.name !== 'Error' ? error.name + ': ' : '') + message, ...(error?.status ? { status: error.status } : {}) });
      console.error(label + ': failed: ' + message);
      if (error?.name === 'MissingApiKeyError' || error?.status === 401 || error?.status === 403) {
        console.error('The key: --api-key-env <NAME>, --api-key-file <path>, --api-key <key>, TTS_API_KEY, or the provider’s own variable.');
        // The same key fails every line: stop here.
        for (const rest of lines.slice(lines.indexOf(line) + 1)) failed.push({ n: rest.n, name: rest.name ?? undefined, text: rest.text, error: 'not tried' });
        break;
      }
    }
  }

  const report = { model: modelName, voice, format, mime, clips, failed };
  if (many) {
    // Kept beside the clips, with what earlier runs recorded: --only 3 changes line 3 and leaves the rest.
    const kept = join(folder, 'tts.json');
    let before = [];
    try {
      const old = JSON.parse(readFileSync(kept, 'utf8'));
      if (Array.isArray(old.clips)) before = old.clips;
    } catch {
      before = [];
    }
    const names = new Set(clips.map((clip) => clip.name));
    const all = [...before.filter((clip) => !names.has(clip.name)), ...clips].sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
    writeFileSync(kept, JSON.stringify({ model: modelName, voice, format, mime, clips: all }, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return failed.length ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    if (error instanceof UsageError) {
      console.error('tts: ' + error.message + '\n(--help lists the options)');
      process.exitCode = 2;
    } else {
      console.error('tts: ' + (error?.stack ?? String(error)));
      process.exitCode = 1;
    }
  },
);
