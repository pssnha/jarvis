-- Members-only schedule access: a circle sets a support passphrase, and a site
-- admin can mint a time-limited "break-glass" grant to access the circle's data.
ALTER TABLE `Circle` ADD COLUMN `supportPassphraseHash` TEXT NULL;

CREATE TABLE `CircleSupportGrant` (
  `id` VARCHAR(191) NOT NULL,
  `circleId` VARCHAR(191) NOT NULL,
  `authUserId` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `CircleSupportGrant_circleId_authUserId_key` (`circleId`, `authUserId`),
  INDEX `CircleSupportGrant_authUserId_expiresAt_idx` (`authUserId`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CircleSupportGrant`
  ADD CONSTRAINT `CircleSupportGrant_circleId_fkey` FOREIGN KEY (`circleId`) REFERENCES `Circle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `CircleSupportGrant_authUserId_fkey` FOREIGN KEY (`authUserId`) REFERENCES `AuthUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
