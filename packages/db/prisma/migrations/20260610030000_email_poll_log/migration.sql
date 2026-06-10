-- Activity log of mailbox poll runs (shown under Email).
CREATE TABLE `EmailPollLog` (
  `id` VARCHAR(191) NOT NULL,
  `circleId` VARCHAR(191) NOT NULL,
  `ranAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `scanned` INTEGER NOT NULL DEFAULT 0,
  `found` INTEGER NOT NULL DEFAULT 0,
  `error` TEXT NULL,
  PRIMARY KEY (`id`),
  INDEX `EmailPollLog_circleId_ranAt_idx` (`circleId`, `ranAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `EmailPollLog`
  ADD CONSTRAINT `EmailPollLog_circleId_fkey` FOREIGN KEY (`circleId`) REFERENCES `Circle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
