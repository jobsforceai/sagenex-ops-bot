/**
 * The agent loop. Drives Amazon Nova (via Bedrock Converse API) through
 * tool calls until it has a final answer, streaming each step out to the
 * chat UI.
 *
 * Auth: Bedrock long-term API key (Bearer token).
 * Model: apac.amazon.nova-pro-v1:0 in ap-south-1 (cross-region inference profile).
 *
 * We hit the Bedrock REST endpoint directly to avoid pulling the AWS SDK
 * + sigv4 dance — the API key is the only credential we need.
 */
import { SYSTEM_PROMPT } from './system-prompt';
import * as mongoTool from './tools/mongo';
import { runBash } from './tools/bash';
import { readFile, writeScratch, listFiles } from './tools/files';
import { teamBusiness } from './tools/team';

const REGION = process.env.BEDROCK_REGION || 'ap-south-1';
const MODEL = process.env.BEDROCK_MODEL_ID || 'apac.amazon.nova-pro-v1:0';
const BEDROCK_URL = `https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(MODEL)}/converse`;

// ─── tool declarations (Bedrock Converse shape) ─────────────────────────
interface ToolSpec {
  name: string;
  description: string;
  inputSchema: { json: any };
}

const tools: ToolSpec[] = [
  {
    name: 'mongo_list_collections',
    description: 'Returns the list of all collections in the live Mongo DB.',
    inputSchema: { json: { type: 'object', properties: {}, required: [] } },
  },
  {
    name: 'mongo_find',
    description: 'Read-only find against a Mongo collection. Filter, projection, sort use standard Mongo JSON. limit defaults to 50, max 200.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          collection: { type: 'string' },
          filter: { type: 'string', description: 'JSON string of the filter doc.' },
          projection: { type: 'string', description: 'JSON string of the projection doc.' },
          sort: { type: 'string', description: 'JSON string of the sort doc.' },
          limit: { type: 'number' },
          skip: { type: 'number' },
        },
        required: ['collection'],
      },
    },
  },
  {
    name: 'mongo_aggregate',
    description: 'Read-only aggregate. `pipeline` is a JSON-string array of stages. Forbidden stages: $out, $merge.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          collection: { type: 'string' },
          pipeline: { type: 'string', description: 'JSON string of the pipeline array.' },
          limit: { type: 'number' },
        },
        required: ['collection', 'pipeline'],
      },
    },
  },
  {
    name: 'mongo_count',
    description: 'countDocuments. filter is a JSON string.',
    inputSchema: {
      json: {
        type: 'object',
        properties: { collection: { type: 'string' }, filter: { type: 'string' } },
        required: ['collection'],
      },
    },
  },
  {
    name: 'mongo_distinct',
    description: 'distinct values of a field. filter is a JSON string.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          collection: { type: 'string' },
          field: { type: 'string' },
          filter: { type: 'string' },
        },
        required: ['collection', 'field'],
      },
    },
  },
  {
    name: 'read_file',
    description: 'Read a file inside REPO_ROOT (relative path, e.g. "repos/sagenex-backend/src/user/user.service.ts").',
    inputSchema: { json: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  },
  {
    name: 'list_files',
    description: 'Recursive file listing under REPO_ROOT. The "glob" argument is NOT a real glob — it is a simple substring filter applied to each path. Examples: glob="payouts.ts" matches any path containing that substring; glob="src/config" matches anything in that folder. Do NOT pass "**/*.ts" or other glob syntax — use substring strings only. For full-text/regex search across file contents, use the bash tool with `rg` instead.',
    inputSchema: { json: { type: 'object', properties: { glob: { type: 'string', description: 'Substring filter (not a real glob).' } }, required: [] } },
  },
  {
    name: 'write_scratch',
    description: 'Write a file under REPO_ROOT/scratch/<path>. Use this to scaffold ad-hoc audit scripts, then run with bash.',
    inputSchema: {
      json: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
  },
  {
    name: 'team_business',
    description: 'Compute the team-business (sum of downline PACKAGE_ACTIVATION volume in INR) for a given user, optionally restricted to a date range. This is the deterministic, fast way to answer "what is the team business of UXXX". Prefer this over hand-written aggregations. Returns downline size, activation count, and the total ₹. startDate/endDate are ISO strings (e.g. "2026-05-12"). includeSelf defaults to false (counts only the downline).',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          startDate: { type: 'string', description: 'ISO date — inclusive lower bound. Omit for lifetime.' },
          endDate: { type: 'string', description: 'ISO date — exclusive upper bound. Omit for lifetime.' },
          includeSelf: { type: 'boolean' },
        },
        required: ['userId'],
      },
    },
  },
  {
    name: 'bash',
    description: 'Run a read-only shell command inside REPO_ROOT. 30s timeout. Use for rg/grep/find/cat or `cd repos/sagenex-backend && npx ts-node ../../scratch/foo.ts`.',
    inputSchema: { json: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  },
];

const parseJson = (input: any) => {
  if (input == null || input === '') return undefined;
  if (typeof input !== 'string') return input;
  // Nova quirk: it sometimes prefixes arrays with a stray leading comma like ",[{...}]".
  // Strip leading whitespace + comma before the first JSON char.
  let cleaned = input.replace(/^\s*,+\s*/, '');
  try { return JSON.parse(cleaned); } catch {}
  const relaxed = cleaned
    .replace(/(['\"])(?:(?=(\\?))\2.)*?\1/g, (m) => (m.startsWith("'") ? '"' + m.slice(1, -1).replace(/"/g, '\\"') + '"' : m))
    .replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(relaxed); } catch (e: any) {
    const around = input.length > 80 ? input.slice(0, 80) + '…' : input;
    throw new Error(`Invalid JSON: ${e.message}. Got: ${around}`);
  }
};

// ─── tool dispatcher ────────────────────────────────────────────────────
async function executeTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'mongo_list_collections': return { collections: await mongoTool.listCollections() };
    case 'mongo_find':
      return await mongoTool.mongoFind({
        collection: args.collection,
        filter: parseJson(args.filter),
        projection: parseJson(args.projection),
        sort: parseJson(args.sort),
        limit: args.limit,
        skip: args.skip,
      });
    case 'mongo_aggregate':
      return await mongoTool.mongoAggregate({ collection: args.collection, pipeline: parseJson(args.pipeline) ?? [], limit: args.limit });
    case 'mongo_count':
      return await mongoTool.mongoCount({ collection: args.collection, filter: parseJson(args.filter) });
    case 'mongo_distinct':
      return await mongoTool.mongoDistinct({ collection: args.collection, field: args.field, filter: parseJson(args.filter) });
    case 'read_file':       return await readFile(args.path);
    case 'list_files':      return await listFiles(args.glob);
    case 'write_scratch':   return await writeScratch(args.path, args.content);
    case 'team_business':   return await teamBusiness(args);
    case 'bash':            return await runBash(args.command);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

export interface ChatTurn { role: 'user' | 'model'; content: string; }
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; name: string; args: any }
  | { type: 'tool_result'; name: string; result: any; isError?: boolean }
  | { type: 'done' };

const MAX_TOOL_ITERATIONS = 10;

// Bedrock Converse message shape — assistant uses "assistant", we map history "model" → "assistant".
type ConverseMessage = {
  role: 'user' | 'assistant';
  content: any[];
};

async function callConverse(payload: any): Promise<any> {
  const apiKey = process.env.BEDROCK_API_KEY;
  if (!apiKey) throw new Error('BEDROCK_API_KEY not set');
  const res = await fetch(BEDROCK_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bedrock HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

export async function* runAgent(history: ChatTurn[], userMessage: string): AsyncGenerator<AgentEvent> {
  const messages: ConverseMessage[] = [];
  for (const turn of history) {
    messages.push({ role: turn.role === 'model' ? 'assistant' : 'user', content: [{ text: turn.content }] });
  }
  messages.push({ role: 'user', content: [{ text: userMessage }] });

  let nudgedOnce = false;
  const recentToolFingerprints: string[] = [];
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    let result;
    try {
      result = await callConverse({
        messages,
        system: [{ text: SYSTEM_PROMPT }],
        toolConfig: { tools: tools.map(t => ({ toolSpec: t })) },
        inferenceConfig: { temperature: 0.2, maxTokens: 4000 },
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      yield { type: 'text', text: `ERROR: ${msg}` };
      yield { type: 'done' };
      return;
    }

    const assistantContent: any[] = result?.output?.message?.content ?? [];
    const stopReason: string = result?.stopReason ?? '';

    // Append the assistant turn to history so we can include tool results next.
    messages.push({ role: 'assistant', content: assistantContent });

    // Collect any toolUse parts.
    const toolUses = assistantContent.filter((c: any) => c.toolUse).map((c: any) => c.toolUse);
    const textParts = assistantContent
      .filter((c: any) => typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('')
      .trim()
      // Nova often wraps internal thinking in <thinking>…</thinking> — strip it from user-facing text.
      .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
      .trim();

    if (toolUses.length === 0) {
      const isPermissionAsk = /would you like|shall i|should i (?:proceed|continue|run)|do you want me|let me know if you want|may i (?:proceed|continue)|here'?s the plan|here is the plan|i will (?:write|run|execute|now)|let me write|i'?ll (?:write|run|execute|now)|^plan:/i.test(textParts);
      if (textParts && !isPermissionAsk) {
        yield { type: 'text', text: textParts };
        yield { type: 'done' };
        return;
      }
      if (!nudgedOnce) {
        nudgedOnce = true;
        messages.push({
          role: 'user',
          content: [{ text: textParts
            ? 'STOP narrating. Call the tool NOW. Do not write any more text until you have actual results. Just call the tool — no more explanation, no more planning — execute.'
            : 'Please produce your final answer for the user now using the data you have already gathered.' }],
        });
        continue;
      }
      yield { type: 'text', text: '(model stopped without producing a final answer — try rephrasing or ask again)' };
      yield { type: 'done' };
      return;
    }

    // Execute each tool call and assemble a `user` message containing toolResult blocks.
    const toolResultBlocks: any[] = [];
    for (const tu of toolUses) {
      // Loop-break: if the same (tool, args) was just called twice with empty/error results,
      // append a hint to nudge the model toward a different strategy.
      const fingerprint = `${tu.name}:${JSON.stringify(tu.input ?? {})}`;
      recentToolFingerprints.push(fingerprint);
      if (recentToolFingerprints.length > 5) recentToolFingerprints.shift();
      yield { type: 'tool_call', name: tu.name, args: tu.input };
      let toolOut: any;
      let isError = false;
      try {
        toolOut = await executeTool(tu.name, tu.input || {});
      } catch (e: any) {
        isError = true;
        toolOut = { error: e?.message || String(e) };
      }
      yield { type: 'tool_result', name: tu.name, result: toolOut, isError };
      toolResultBlocks.push({
        toolResult: {
          toolUseId: tu.toolUseId,
          content: [{ text: JSON.stringify(toolOut).slice(0, 200_000) }],
          ...(isError ? { status: 'error' } : {}),
        },
      });
    }
    messages.push({ role: 'user', content: toolResultBlocks });

    // Detect repeated calls — AAA (same 3 in a row) or ABAB (alternating loop).
    if (recentToolFingerprints.length >= 4) {
      const fps = recentToolFingerprints;
      const last = fps[fps.length - 1];
      const same3 = fps.slice(-3).every(f => f === last);
      const abab =
        fps.length >= 4 &&
        fps[fps.length - 1] === fps[fps.length - 3] &&
        fps[fps.length - 2] === fps[fps.length - 4] &&
        fps[fps.length - 1] !== fps[fps.length - 2];
      if (same3 || abab) {
        messages.push({
          role: 'user',
          content: [{ text: 'You have called the same tool with the same arguments three times in a row and it is not making progress. STOP repeating that call. Try a completely different approach — e.g., use `bash` with `rg` for content search, or call `mongo_list_collections` first to understand what is available. If you cannot find what was asked, just answer in plain English that you could not find it.' }],
        });
      }
    }
  }
  yield { type: 'text', text: `(stopped after ${MAX_TOOL_ITERATIONS} tool iterations)` };
  yield { type: 'done' };
}
