import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sales = fileURLToPath(new URL('../e2e/fixtures/data/sales-mcp.mjs', import.meta.url));

export function writeTestConnectors(state) {
  mkdirSync(state, { recursive: true });
  const file = path.join(state, 'connectors.json');
  writeFileSync(file, JSON.stringify({ mcpServers: { sales: { command: process.execPath, args: [sales] } } }));
  return file;
}
