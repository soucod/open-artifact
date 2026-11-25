#!/usr/bin/env node
// A stdio MCP server with made-up sales numbers, for the Data type's tests.
// Tools: run_sql (orders filtered by the region the query names), list_tickets
// (one content block per ticket plus a paging block) and broken (a tool error).
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const text = value => ({ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) });

const ORDERS = [];
const months = ['2026-07', '2026-08', '2026-09', '2026-10'];
const base = { North: 1200, South: 900, East: 800, West: 1100 };
for (const [region, start] of Object.entries(base)) {
  months.forEach((month, i) => ORDERS.push({ region, month, revenue: String(start + i * 150 + region.length * 10), orders: String(20 + i * 3) }));
}

const TICKETS = [
  'T-101 | open | Login fails on Safari',
  'T-102 | closed | Export button hidden',
  'T-103 | open | Chart colors too light',
];

const tools = [
  { name: 'run_sql', description: 'Run a read-only SQL query on the sales warehouse.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'list_tickets', description: 'List support tickets, one block each.', inputSchema: { type: 'object', properties: { status: { type: 'string' } } } },
  { name: 'broken', description: 'Always fails.', inputSchema: { type: 'object' } },
];

// SALES_MCP_BONUS_FILE names a file holding a number added to every revenue, read on each call, so a test can change
// what the warehouse answers while the server runs.
function bonus() {
  const file = process.env.SALES_MCP_BONUS_FILE;
  if (!file) return 0;
  try {
    return Number(readFileSync(file, 'utf8').trim()) || 0;
  } catch {
    return 0;
  }
}

function runSql(args) {
  const query = String(args.query ?? '');
  const extra = bonus();
  const named = /region\s*=\s*'([A-Za-z]+)'/.exec(query);
  const all = /'([A-Za-z]*)'\s*=\s*''/.exec(query);
  const region = all && all[1] === '' ? null : named?.[1] ?? null;
  const rows = ORDERS.filter(o => region === null || o.region === region).map(o => (extra ? { ...o, revenue: String(Number(o.revenue) + extra) } : o));
  return { content: [text({ rows, query })], structuredContent: { rows, query } };
}

function listTickets(args) {
  const wanted = args.status ? String(args.status) : null;
  const picked = TICKETS.filter(t => wanted === null || t.split(' | ')[1] === wanted);
  return { content: [...picked.map(text), text(`page 1 of 1 (${picked.length} tickets)`)] };
}

function call(id, name, args) {
  switch (name) {
    case 'run_sql':
      return send({ jsonrpc: '2.0', id, result: runSql(args) });
    case 'list_tickets':
      return send({ jsonrpc: '2.0', id, result: listTickets(args) });
    case 'broken':
      return send({ jsonrpc: '2.0', id, result: { content: [text('The warehouse is offline for maintenance.')], isError: true } });
    default:
      return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } });
  }
}

createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.method === undefined) return;
  switch (message.method) {
    case 'initialize':
      return send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'sales', version: '1.0.0' } } });
    case 'notifications/initialized':
      return;
    case 'tools/list':
      return send({ jsonrpc: '2.0', id: message.id, result: { tools } });
    case 'tools/call':
      return call(message.id, message.params?.name, message.params?.arguments ?? {});
    case 'ping':
      return send({ jsonrpc: '2.0', id: message.id, result: {} });
    default:
      if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Unknown method: ${message.method}` } });
  }
});
