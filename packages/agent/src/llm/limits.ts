import { DateTime } from 'luxon';
import { prisma } from '@jarvis/db';
import { estimateCost } from './pricing';

/** Estimated USD spent by a circle on LLM calls since `since` (inclusive). */
export async function circleSpendUsd(circleId: string, since: Date): Promise<number> {
  const grouped = await prisma.llmUsage.groupBy({
    by: ['model'],
    where: { circleId, createdAt: { gte: since } },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheCreationTokens: true,
    },
  });
  return grouped.reduce(
    (total, g) =>
      total +
      estimateCost({
        model: g.model,
        inputTokens: g._sum.inputTokens ?? 0,
        outputTokens: g._sum.outputTokens ?? 0,
        cacheReadTokens: g._sum.cacheReadTokens ?? 0,
        cacheCreationTokens: g._sum.cacheCreationTokens ?? 0,
      }),
    0,
  );
}

export interface CircleUsageStatus {
  dailyUsd: number;
  monthlyUsd: number;
  dailyLimit: number;
  monthlyLimit: number;
  /** True once today's or this month's estimated spend has reached its limit. */
  blocked: boolean;
}

/** A circle's spend against its caps. Windows are the circle's local day/month. */
export async function circleUsageStatus(
  circleId: string,
  timezone: string,
): Promise<CircleUsageStatus> {
  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    select: { dailyUsdLimit: true, monthlyUsdLimit: true },
  });
  const dailyLimit = circle?.dailyUsdLimit ?? 0;
  const monthlyLimit = circle?.monthlyUsdLimit ?? 0;

  const now = DateTime.now().setZone(timezone);
  const startOfDay = now.startOf('day').toUTC().toJSDate();
  const startOfMonth = now.startOf('month').toUTC().toJSDate();

  const [dailyUsd, monthlyUsd] = await Promise.all([
    circleSpendUsd(circleId, startOfDay),
    circleSpendUsd(circleId, startOfMonth),
  ]);

  return {
    dailyUsd,
    monthlyUsd,
    dailyLimit,
    monthlyLimit,
    blocked: dailyUsd >= dailyLimit || monthlyUsd >= monthlyLimit,
  };
}
