/**
 * Pre-computed analytical tools — wrap the common downline-aggregation
 * patterns so Nova doesn't have to write complex $graphLookup+$lookup
 * pipelines (which it struggles with).
 */
import { getMongoDb } from '../mongo-client';

interface TeamBusinessArgs {
  userId: string;
  startDate?: string; // ISO date inclusive
  endDate?: string;   // ISO date exclusive
  includeSelf?: boolean; // default false — counts only downline
}

export async function teamBusiness(args: TeamBusinessArgs) {
  const { userId, startDate, endDate, includeSelf = false } = args;
  if (!userId) throw new Error('userId required');

  const db = await getMongoDb();
  // 1. Get the downline userIds (single $graphLookup).
  const agg = await db.collection('users').aggregate([
    { $match: { userId } },
    {
      $graphLookup: {
        from: 'users',
        startWith: '$userId',
        connectFromField: 'userId',
        connectToField: 'parentId',
        as: 'd',
      },
    },
    { $project: { ids: '$d.userId' } },
  ]).toArray();

  if (!agg[0]) return { error: `User ${userId} not found.` };
  const downlineIds: string[] = agg[0].ids ?? [];
  const allIds = includeSelf ? [userId, ...downlineIds] : downlineIds;

  // 2. Sum PACKAGE_ACTIVATION volume in that set, optionally date-restricted.
  const match: any = {
    userId: { $in: allIds },
    type: 'PACKAGE_ACTIVATION',
    status: 'POSTED',
  };
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) match.createdAt.$lt = new Date(endDate);
  }
  const result = await db.collection('walletledgers').aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]).toArray();

  return {
    userId,
    downlineSize: downlineIds.length,
    includeSelf,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
    activationCount: result[0]?.count ?? 0,
    teamBusinessINR: result[0]?.total ?? 0,
  };
}
