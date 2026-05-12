/**
 * The agent loop. Drives Gemini through tool calls until it has a final
 * answer, streaming each step out to the chat UI.
 */
import { GoogleGenerativeAI, FunctionDeclaration, FunctionCallingMode, SchemaType, Content } from '@google/generative-ai';
import { SYSTEM_PROMPT } from './system-prompt';
import * as mongoTool from './tools/mongo';
import { runBash } from './tools/bash';
import { readFile, writeScratch, listFiles } from './tools/files';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro';

// ─── tool declarations (what Gemini sees) ───────────────────────────────
const tools: FunctionDeclaration[] = [
  {
    name: 'mongo_list_collections',
    description: 'Returns the list of all collections in the live Mongo DB.',
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  {
    name: 'mongo_find',
    description: 'Read-only find against a Mongo collection. Filter, projection, sort use standard Mongo JSON. limit defaults to 50, max 200.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        collection: { type: SchemaType.STRING },
        filter: { type: SchemaType.STRING, description: 'JSON string of the filter doc.' },
        projection: { type: SchemaType.STRING, description: 'JSON string of the projection doc.' },
        sort: { type: SchemaType.STRING, description: 'JSON string of the sort doc.' },
        limit: { type: SchemaType.NUMBER },
        skip: { type: SchemaType.NUMBER },
      },
      required: ['collection'],
    },
  },
  {
    name: 'mongo_aggregate',
    description: 'Read-only aggregate. `pipeline` is a JSON-string array of stages. Forbidden stages: $out, $merge.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        collection: { type: SchemaType.STRING },
        pipeline: { type: SchemaType.STRING, description: 'JSON string of the pipeline array.' },
        limit: { type: SchemaType.NUMBER },
      },
      required: ['collection', 'pipeline'],
    },
  },
  {
    name: 'mongo_count',
    description: 'countDocuments. filter is a JSON string.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { collection: { type: SchemaType.STRING }, filter: { type: SchemaType.STRING } },
      required: ['collection'],
    },
  },
  {
    name: 'mongo_distinct',
    description: 'distinct values of a field. filter is a JSON string.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        collection: { type: SchemaType.STRING },
        field: { type: SchemaType.STRING },
        filter: { type: SchemaType.STRING },
      },
      required: ['collection', 'field'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file inside REPO_ROOT (relative path, e.g. "repos/sagenex-backend/src/user/user.service.ts").',
    parameters: { type: SchemaType.OBJECT, properties: { path: { type: SchemaType.STRING } }, required: ['path'] },
  },
  {
    name: 'list_files',
    description: 'Recursive listing of REPO_ROOT. Optional substring filter.',
    parameters: { type: SchemaType.OBJECT, properties: { glob: { type: SchemaType.STRING } }, required: [] },
  },
  {
    name: 'write_scratch',
    description: 'Write a file under REPO_ROOT/scratch/<path>. Use this to scaffold ad-hoc audit scripts, then run with bash.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { path: { type: SchemaType.STRING }, content: { type: SchemaType.STRING } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'bash',
    description: 'Run a read-only shell command inside REPO_ROOT. 30s timeout. Use for rg/grep/find/cat or `cd repos/sagenex-backend && npx ts-node ../../scratch/foo.ts`.',
    parameters: { type: SchemaType.OBJECT, properties: { command: { type: SchemaType.STRING } }, required: ['command'] },
  },
];

const parseJson = (s: any) => {
  if (s == null || s === '') return undefined;
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch (e: any) { throw new Error(`Invalid JSON arg: ${e.message}`); }
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

const MAX_TOOL_ITERATIONS = 20;

export async function* runAgent(history: ChatTurn[], userMessage: string): AsyncGenerator<AgentEvent> {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: tools }],
    toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } },
  });

  const contents: Content[] = [];
  for (const turn of history) contents.push({ role: turn.role, parts: [{ text: turn.content }] });
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const result = await model.generateContent({ contents });
    const response = result.response;
    const cand = response.candidates?.[0];
    if (!cand) { yield { type: 'text', text: '(no candidate returned)' }; break; }

    const parts = cand.content?.parts || [];
    contents.push({ role: 'model', parts });

    const fnCalls = parts.filter((p: any) => p.functionCall);
    if (fnCalls.length === 0) {
      const text = parts.map((p: any) => p.text || '').join('');
      if (text) yield { type: 'text', text };
      yield { type: 'done' };
      return;
    }

    const fnResponses: any[] = [];
    for (const part of fnCalls) {
      const call = (part as any).functionCall;
      yield { type: 'tool_call', name: call.name, args: call.args };
      let result: any;
      let isError = false;
      try { result = await executeTool(call.name, call.args || {}); }
      catch (e: any) { isError = true; result = { error: e?.message || String(e) }; }
      yield { type: 'tool_result', name: call.name, result, isError };
      fnResponses.push({ functionResponse: { name: call.name, response: { content: JSON.stringify(result).slice(0, 200_000) } } });
    }
    contents.push({ role: 'user', parts: fnResponses });
  }
  yield { type: 'text', text: `(stopped after ${MAX_TOOL_ITERATIONS} tool iterations)` };
  yield { type: 'done' };
}
