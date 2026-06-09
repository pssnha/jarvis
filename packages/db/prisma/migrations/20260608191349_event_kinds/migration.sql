-- AlterTable
ALTER TABLE `Event` ADD COLUMN `kind` VARCHAR(191) NOT NULL DEFAULT 'reminder',
    ADD COLUMN `reminderLeadMinutes` INTEGER NULL;
