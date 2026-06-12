-- Per-call LLM token usage, attributed to a circle (for billing).
CREATE TABLE `LlmUsage` (
  `id` VARCHAR(191) NOT NULL,
  `circleId` VARCHAR(191) NULL,
  `model` VARCHAR(191) NOT NULL,
  `source` VARCHAR(191) NOT NULL,
  `inputTokens` INTEGER NOT NULL DEFAULT 0,
  `outputTokens` INTEGER NOT NULL DEFAULT 0,
  `cacheReadTokens` INTEGER NOT NULL DEFAULT 0,
  `cacheCreationTokens` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `LlmUsage_circleId_createdAt_idx` (`circleId`, `createdAt`),
  INDEX `LlmUsage_createdAt_idx` (`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `LlmUsage`
  ADD CONSTRAINT `LlmUsage_circleId_fkey` FOREIGN KEY (`circleId`) REFERENCES `Circle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
