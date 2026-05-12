/**
 * Read-only MongoDB tool for the ops agent.
 *
 * Even though we use full DB credentials, we enforce read-only at the tool
 * layer by:
 *   - only exposing find / aggregate / countDocuments / distinct
 *   - rejecting aggregation pipelines that contain $out or $merge
 *   - capping result size (rows + bytes) so the model can't blow context
 *
 * Mutations of any kind are simply not callable from this tool.
 */
import { getMongoDb } from '../mongo-client';

const MAX_ROWS = 200;
const MAX_BYTES = 200_000;
const FORBIDDEN_STAGES = new Set(['$out', '$merge']);

// Walk a query/projection/pipeline doc and coerce values that LOOK like ISO
// dates (e.g. "2025-11-30T00:00:00.000Z" or {"$date":"..."}) into Date objects
// so Mongo comparisons against Date fields actually match. Also handles
// {"$oid":"..."} for ObjectId.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z?$/;
const coerce = (v: any): any => {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string' && ISO_DATE_RE.test(v)) return new Date(v);
  if (Array.isArray(v)) return v.map(coerce);
  if (typeof v === 'object') {
    if ('$date' in v && typeof v['$date'] === 'string') return new Date(v['$date']);
    if ('$oid' in v && typeof v['$oid'] === 'string') {
      const { ObjectId } = require('mongodb');
      return new ObjectId(v['$oid']);
    }
    const out: any = {};
    for (const k of Object.keys(v)) out[k] = coerce(v[k]);
    return out;
  }
  return v;
};

const trimResults = (rows: any[]) => {
  let bytes = 0;
  const out: any[] = [];
  for (const r of rows) {
    const s = JSON.stringify(r);
    if (bytes + s.length > MAX_BYTES) {
      out.push({ __truncated: `Result truncated at ${MAX_BYTES} bytes (${out.length}/${rows.length} rows kept).` });
      return out;
    }
    bytes += s.length;
    out.push(r);
    if (out.length >= MAX_ROWS) break;
  }
  return out;
};

const checkStages = (pipeline: any[]) => {
  for (const stage of pipeline) {
    if (!stage || typeof stage !== 'object') continue;
    for (const key of Object.keys(stage)) {
      if (FORBIDDEN_STAGES.has(key)) throw new Error(`Forbidden stage: ${key}`);
    }
  }
};

export async function listCollections(): Promise<string[]> {
  const db = await getMongoDb();
  const cols = await db.listCollections({}, { nameOnly: true }).toArray();
  return cols.map((c) => c.name).sort();
}

export async function mongoFind(args: {
  collection: string;
  filter?: any;
  projection?: any;
  sort?: any;
  limit?: number;
  skip?: number;
}): Promise<{ count: number; rows: any[] }> {
  const db = await getMongoDb();
  const limit = Math.min(args.limit ?? 50, MAX_ROWS);
  const rows = await db
    .collection(args.collection)
    .find(coerce(args.filter ?? {}), { projection: args.projection })
    .maxTimeMS(25_000)
    .sort(coerce(args.sort ?? {}))
    .skip(args.skip ?? 0)
    .limit(limit)
    .toArray();
  return { count: rows.length, rows: trimResults(rows) };
}

export async function mongoAggregate(args: {
  collection: string;
  pipeline: any[];
  limit?: number;
}): Promise<{ count: number; rows: any[] }> {
  checkStages(args.pipeline);
  const db = await getMongoDb();
  const limit = Math.min(args.limit ?? 50, MAX_ROWS);
  const rows = await db
    .collection(args.collection)
    .aggregate([...coerce(args.pipeline), { $limit: limit }], { maxTimeMS: 25_000, allowDiskUse: true })
    .toArray();
  return { count: rows.length, rows: trimResults(rows) };
}

export async function mongoCount(args: { collection: string; filter?: any }) {
  const db = await getMongoDb();
  const n = await db.collection(args.collection).countDocuments(coerce(args.filter ?? {}));
  return { count: n };
}

export async function mongoDistinct(args: { collection: string; field: string; filter?: any }) {
  const db = await getMongoDb();
  const vals = await db.collection(args.collection).distinct(args.field, coerce(args.filter ?? {}));
  return { count: vals.length, values: vals.slice(0, MAX_ROWS) };
}
