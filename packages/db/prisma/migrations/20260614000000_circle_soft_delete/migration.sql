-- Soft-delete for circles: schedule deletion (deletedAt) and a grace deadline
-- (purgeAfter) after which the worker hard-deletes the circle and its data.
ALTER TABLE `Circle`
  ADD COLUMN `deletedAt` DATETIME(3) NULL,
  ADD COLUMN `purgeAfter` DATETIME(3) NULL;

CREATE INDEX `Circle_purgeAfter_idx` ON `Circle` (`purgeAfter`);
