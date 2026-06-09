-- AlterTable
ALTER TABLE `Group` ADD COLUMN `emailAddress` VARCHAR(191) NULL,
    ADD COLUMN `emailEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `emailEncCred` TEXT NULL,
    ADD COLUMN `emailFirstScanDone` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `emailHost` VARCHAR(191) NULL,
    ADD COLUMN `emailLastPolledAt` DATETIME(3) NULL,
    ADD COLUMN `emailLastUid` INTEGER NULL,
    ADD COLUMN `emailPort` INTEGER NULL;

-- CreateTable
CREATE TABLE `EmailProposal` (
    `id` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `summary` TEXT NOT NULL,
    `payload` TEXT NOT NULL,
    `fromEmail` VARCHAR(191) NULL,
    `subject` VARCHAR(191) NULL,
    `messageId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `notifiedAt` DATETIME(3) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `EmailProposal_groupId_status_idx`(`groupId`, `status`),
    INDEX `EmailProposal_messageId_idx`(`messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Group_emailAddress_key` ON `Group`(`emailAddress`);

-- AddForeignKey
ALTER TABLE `EmailProposal` ADD CONSTRAINT `EmailProposal_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

