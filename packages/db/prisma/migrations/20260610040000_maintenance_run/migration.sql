-- Maintenance job-run log (daily_brief, health_check, …) for the Maintenance calendar.
CREATE TABLE `MaintenanceRun` (
  `id` VARCHAR(191) NOT NULL,
  `job` VARCHAR(191) NOT NULL,
  `circleId` VARCHAR(191) NULL,
  `ranAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ok` BOOLEAN NOT NULL DEFAULT true,
  `summary` TEXT NULL,
  PRIMARY KEY (`id`),
  INDEX `MaintenanceRun_ranAt_idx` (`ranAt`),
  INDEX `MaintenanceRun_job_ranAt_idx` (`job`, `ranAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MaintenanceRun`
  ADD CONSTRAINT `MaintenanceRun_circleId_fkey` FOREIGN KEY (`circleId`) REFERENCES `Circle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
