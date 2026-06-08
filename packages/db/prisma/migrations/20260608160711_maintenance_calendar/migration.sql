-- AlterTable
ALTER TABLE `Event` ADD COLUMN `maintainsGroupId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Group` ADD COLUMN `kind` VARCHAR(191) NOT NULL DEFAULT 'group';

-- AddForeignKey
ALTER TABLE `Event` ADD CONSTRAINT `Event_maintainsGroupId_fkey` FOREIGN KEY (`maintainsGroupId`) REFERENCES `Group`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
