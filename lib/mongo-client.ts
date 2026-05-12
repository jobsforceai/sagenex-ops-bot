import { MongoClient, Db } from 'mongodb';

let cached: { client: MongoClient; db: Db } | null = null;

export async function getMongoDb(): Promise<Db> {
  if (cached) return cached.db;
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  const client = new MongoClient(uri, { maxPoolSize: 4 });
  await client.connect();
  cached = { client, db: client.db() };
  return cached.db;
}
