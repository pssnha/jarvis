-- Single-occurrence overrides: one instance of a recurring series can be
-- detached into its own row (rrule null) that points back at the parent via
-- `recurrenceParentId` and records the original instant it replaces
-- (`recurrenceStart`), so the parent's expansion skips that instant.
ALTER TABLE `Event` ADD COLUMN `recurrenceParentId` VARCHAR(191) NULL;
ALTER TABLE `Event` ADD COLUMN `recurrenceStart` DATETIME(3) NULL;

CREATE INDEX `Event_recurrenceParentId_idx` ON `Event`(`recurrenceParentId`);

ALTER TABLE `Event`
  ADD CONSTRAINT `Event_recurrenceParentId_fkey` FOREIGN KEY (`recurrenceParentId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
