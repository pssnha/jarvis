-- Per-circle LLM spend caps (USD, estimated). Enforced before each agent call;
-- configurable on the Billing page by site admins. Defaults: $1/day, $25/month.
ALTER TABLE `Circle`
  ADD COLUMN `dailyUsdLimit`   DOUBLE NOT NULL DEFAULT 1,
  ADD COLUMN `monthlyUsdLimit` DOUBLE NOT NULL DEFAULT 25;
