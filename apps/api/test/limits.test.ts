import '../src/loadEnv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@jarvis/db';
import { circleUsageStatus } from '@jarvis/agent';

/**
 * Per-circle LLM spend caps: circleUsageStatus reports `blocked` once today's
 * estimated spend reaches the daily limit, and stays clear under it.
 *
 * DB-gated: skipped wholesale when no database is reachable (bare CI).
 */

const TZ = 'America/Los_Angeles';
const SUF = `lim_${Date.now()}`;
const id = (s: string) => `${SUF}_${s}`;
let dbOk = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
    return;
  }
  // "Over": tiny daily cap. "Under": generous caps.
  await prisma.circle.create({
    data: { id: id('over'), name: id('Over'), timezone: TZ, dailyUsdLimit: 0.25, monthlyUsdLimit: 25 },
  });
  await prisma.circle.create({
    data: { id: id('under'), name: id('Under'), timezone: TZ, dailyUsdLimit: 2, monthlyUsdLimit: 50 },
  });
  // Opus input is $15 / 1M tokens → 100k tokens ≈ $1.50 (well over $0.25).
  await prisma.llmUsage.create({
    data: { circleId: id('over'), model: 'claude-opus-4-8', source: 'web', inputTokens: 100_000, outputTokens: 0 },
  });
  // 1k tokens ≈ $0.015 — comfortably under both caps.
  await prisma.llmUsage.create({
    data: { circleId: id('under'), model: 'claude-opus-4-8', source: 'web', inputTokens: 1_000, outputTokens: 0 },
  });
});

afterAll(async () => {
  if (!dbOk) return;
  await prisma.llmUsage.deleteMany({ where: { circleId: { in: [id('over'), id('under')] } } });
  await prisma.circle.deleteMany({ where: { id: { in: [id('over'), id('under')] } } });
  await prisma.$disconnect();
});

describe('per-circle usage limits', () => {
  it('blocks a circle over its daily cap', async (ctx) => {
    if (!dbOk) return ctx.skip();
    const u = await circleUsageStatus(id('over'), TZ);
    expect(u.dailyUsd).toBeGreaterThan(u.dailyLimit);
    expect(u.blocked).toBe(true);
  });

  it('allows a circle under its caps', async (ctx) => {
    if (!dbOk) return ctx.skip();
    const u = await circleUsageStatus(id('under'), TZ);
    expect(u.dailyUsd).toBeLessThan(u.dailyLimit);
    expect(u.monthlyUsd).toBeLessThan(u.monthlyLimit);
    expect(u.blocked).toBe(false);
  });
});
