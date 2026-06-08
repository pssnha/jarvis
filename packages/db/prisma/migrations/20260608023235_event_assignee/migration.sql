-- AlterTable
ALTER TABLE `Event` ADD COLUMN `assigneeId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Event_assigneeId_idx` ON `Event`(`assigneeId`);

-- AddForeignKey
ALTER TABLE `Event` ADD CONSTRAINT `Event_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `Member`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
