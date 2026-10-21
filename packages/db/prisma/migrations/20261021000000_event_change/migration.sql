-- Change feed of event mutations for MCP clients (list_event_changes).
CREATE TABLE `EventChange` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `circleId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `occurrenceStart` DATETIME(3) NULL,
    `groupId` VARCHAR(191) NULL,
    `ownerMemberId` VARCHAR(191) NULL,
    `event` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EventChange_circleId_id_idx`(`circleId`, `id`),
    INDEX `EventChange_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `EventChange` ADD CONSTRAINT `EventChange_circleId_fkey` FOREIGN KEY (`circleId`) REFERENCES `Circle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
