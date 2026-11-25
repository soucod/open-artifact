/**
 * Which addresses an artifact view may load: exactly the origins the daemon lists (`embedOrigins()`, then each
 * `embed/origins` event), never "all of loopback" — another program on this computer may serve loopback too.
 *
 * An entry is an origin (`http://127.0.0.1:4123`) or a CSP-style pattern for per-artifact origins
 * (`http://*.frame.localhost:4123`). Used by `examples/harness-electron` for its navigation checks.
 */

/** A test for one origin or pattern. */
function matcherOf(entry) {
  let pattern;
  try {
    pattern = new URL(entry.replace('*.', 'wildcard-placeholder.'));
  } catch {
    return () => false;
  }
  const wildcard = entry.includes('*.');
  const suffix = wildcard ? pattern.hostname.replace(/^wildcard-placeholder/, '') : null;
  return (url) =>
    url.protocol === pattern.protocol &&
    url.port === pattern.port &&
    (wildcard ? url.hostname.endsWith(suffix) && url.hostname.length > suffix.length : url.hostname === pattern.hostname);
}

/** An allowlist that follows the daemon: `allows(url)` answers for the origins set last. */
export class OriginAllowlist {
  constructor(origins = []) {
    this.set(origins);
  }

  /** Replaces the list (from `embedOrigins().origins`, or an `embed/origins` event's `origins`). */
  set(origins) {
    this.origins = [...origins];
    this.matchers = this.origins.map(matcherOf);
  }

  allows(address) {
    let url;
    try {
      url = new URL(address);
    } catch {
      return false;
    }
    // `blob:` and `about:srcdoc` are the page's own subframes: they have no origin of their own to check here.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return this.matchers.some((matches) => matches(url));
  }

  /**
   * Keeps the list in step with the daemon: now, and on every `embed/origins` event. Returns a function that stops.
   *
   * Entries on another computer (`remote: true`, a remote type's page) are left out until the person agreed to that
   * origin ({@link OriginAllowlist.trust}): a loopback page is this computer's, a remote one is someone else's.
   */
  async follow(oa) {
    const stop = oa.on('event', (event) => {
      if (event.type === 'embed/origins') this.fromDaemon(event);
    });
    try {
      this.fromDaemon(await oa.embedOrigins());
    } catch {
      // an older daemon without `embed.origins`: the list stays as it was given
    }
    return stop;
  }

  /**
   * Lets in a remote origin the person agreed to (the host's `allowRemote` said yes). Like the kit's `ask` gate, which
   * keeps only a yes per origin, the list keeps no refusals: an origin the person declined is simply not trusted — not
   * let in, and asked about again the next time its page is opened.
   */
  trust(origin) {
    (this.trusted ??= new Set()).add(origin);
    if (this.last) this.fromDaemon(this.last);
    else if (!this.origins.includes(origin)) this.set([...this.origins, origin]);
  }

  /** Sets the list from an `embed.origins` answer or event (plus the remote origins trusted so far). */
  fromDaemon(result) {
    this.last = result;
    const trusted = this.trusted ?? new Set();
    const entries = result.entries ?? [];
    const listed = entries.length
      ? entries.filter((entry) => !entry.remote || trusted.has(entry.origin ?? entry.pattern)).map((entry) => entry.origin ?? entry.pattern)
      : [...(result.origins ?? [])];
    this.set([...new Set([...listed, ...trusted])]);
  }
}
