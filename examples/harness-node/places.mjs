/**
 * Where each artifact was last looked at (the Shell's `onPlace` fragment: a slide, a tab, a page), so reopening it
 * goes back there with `goto`. Kept in a JSON file when one is given, else for this run only.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class PlaceMemory {
  constructor(file = null) {
    this.file = file;
    this.places = {};
    if (file) {
      try {
        this.places = JSON.parse(readFileSync(file, 'utf8')) ?? {};
      } catch {
        // first run, or an unreadable file: start empty
      }
    }
  }

  /** The fragment last reported for `artifact` (`open-artifact://artifact/<id>`), or `null`. */
  get(artifact) {
    return this.places[artifact] ?? null;
  }

  set(artifact, hash) {
    if (!hash) delete this.places[artifact];
    else this.places[artifact] = hash;
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.places, null, 2));
    } catch {
      // not worth failing a view for
    }
  }
}
