-- Long-lived Bearer tokens for MCP clients (Meta Muse custom connector) that
-- can't run the OAuth account-linking flow. Only the sha256 is stored.
CREATE TABLE `PersonalAccessToken` (
    `id` VARCHAR(191) NOT NULL,
    `authUserId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PersonalAccessToken_tokenHash_key`(`tokenHash`),
    INDEX `PersonalAccessToken_authUserId_idx`(`authUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PersonalAccessToken` ADD CONSTRAINT `PersonalAccessToken_authUserId_fkey` FOREIGN KEY (`authUserId`) REFERENCES `AuthUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
