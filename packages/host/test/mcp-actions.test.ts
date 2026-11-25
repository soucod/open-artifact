/**
 * The actions remote MCP offers per type: the type server's own list for that type (`actionsOfType`), less what a
 * hosted agent cannot use. Before, the host split the type server's merged list by position, which broke as soon as
 * a list changed order or a type gained an action named like another's.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actionsOfType, TYPES, type TypeName } from '@open-artifact/type-server';
import { LINK_REFUSED_ACTIONS } from '../src/core/link/routes.ts';
import { mcpActionsOf } from '../src/node/mcp.ts';

describe('MCP actions per type', () => {
  it('are the type server\'s list for the type, less the refused ones, in its order', () => {
    for (const type of Object.keys(TYPES) as TypeName[]) {
      const expected = actionsOfType(type).filter((a) => !LINK_REFUSED_ACTIONS.has(a.name)).map((a) => a.name);
      assert.deepEqual(mcpActionsOf(type).map((a) => a.name), expected, type);
      for (const refused of LINK_REFUSED_ACTIONS) assert.ok(!mcpActionsOf(type).some((a) => a.name === refused), `${type} offers ${refused}`);
    }
  });

  it('gives a Sheet its workbook calls and a doc its doc calls, and neither to a whiteboard', () => {
    const names = (type: TypeName): string[] => mcpActionsOf(type).map((a) => a.name);
    assert.ok(names('sheets').includes('widget'));
    assert.ok(!names('sheets').includes('create'));
    assert.ok(names('docs').includes('create'));
    assert.ok(!names('docs').includes('widget'));
    assert.ok(!names('whiteboard').some((n) => n === 'read' || n === 'create' || n === 'widget'));
    assert.ok(names('whiteboard').includes('check'));
    // Each keeps its effect and schema, which the MCP tool uses for its floors.
    const update = mcpActionsOf('docs').find((a) => a.name === 'update')!;
    assert.equal(update.effect, 'write');
    assert.equal(typeof update.schema, 'object');
  });
});
