import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CANDIDATES, windowsCandidates } from '../src/snapshot.ts';

const chrome = 'Google\\Chrome\\Application\\chrome.exe';
const edge = 'Microsoft\\Edge\\Application\\msedge.exe';

describe('the Chrome candidate list', () => {
  it('looks for Chrome and Edge under both Program Files roots, then per user', () => {
    const paths = windowsCandidates({
      ProgramFiles: 'C:\\Program Files',
      ProgramW6432: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\pat\\AppData\\Local',
    });
    assert.deepEqual(paths, [
      `C:\\Program Files\\${chrome}`,
      `C:\\Program Files (x86)\\${chrome}`,
      `C:\\Users\\pat\\AppData\\Local\\${chrome}`,
      `C:\\Program Files\\${edge}`,
      `C:\\Program Files (x86)\\${edge}`,
      `C:\\Users\\pat\\AppData\\Local\\${edge}`,
    ]);
  });

  it('finds a Windows installed on another drive, and still tries C:', () => {
    const paths = windowsCandidates({ ProgramFiles: 'D:\\Program Files', 'ProgramFiles(x86)': 'D:\\Program Files (x86)' });
    assert.deepEqual(paths, [
      `D:\\Program Files\\${chrome}`,
      `D:\\Program Files (x86)\\${chrome}`,
      `C:\\Program Files\\${chrome}`,
      `C:\\Program Files (x86)\\${chrome}`,
      `D:\\Program Files\\${edge}`,
      `D:\\Program Files (x86)\\${edge}`,
      `C:\\Program Files\\${edge}`,
      `C:\\Program Files (x86)\\${edge}`,
    ]);
  });

  it('falls back to the C: roots when the environment names none', () => {
    assert.deepEqual(windowsCandidates({}), [
      `C:\\Program Files\\${chrome}`,
      `C:\\Program Files (x86)\\${chrome}`,
      `C:\\Program Files\\${edge}`,
      `C:\\Program Files (x86)\\${edge}`,
    ]);
  });

  it('treats roots that differ only in case as one', () => {
    const paths = windowsCandidates({ ProgramFiles: 'c:\\program files', 'ProgramFiles(x86)': 'c:\\program files (x86)' });
    assert.equal(paths.length, 4);
  });

  it('has no duplicate paths', () => {
    assert.equal(new Set(CANDIDATES).size, CANDIDATES.length);
  });
});
