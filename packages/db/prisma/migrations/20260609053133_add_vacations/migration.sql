-- CreateTable
CREATE TABLE `Vacation` (
    `id` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `destinations` VARCHAR(191) NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `timezone` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Vacation_groupId_startDate_idx`(`groupId`, `startDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VacationItem` (
    `id` VARCHAR(191) NOT NULL,
    `vacationId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'activity',
    `title` VARCHAR(191) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NULL,
    `allDay` BOOLEAN NOT NULL DEFAULT false,
    `location` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `confirmation` VARCHAR(191) NULL,
    `provider` VARCHAR(191) NULL,
    `number` VARCHAR(191) NULL,
    `fromLabel` VARCHAR(191) NULL,
    `toLabel` VARCHAR(191) NULL,
    `seat` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `cost` VARCHAR(191) NULL,
    `color` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VacationItem_vacationId_startsAt_idx`(`vacationId`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_VacationTravelers` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_VacationTravelers_AB_unique`(`A`, `B`),
    INDEX `_VacationTravelers_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Vacation` ADD CONSTRAINT `Vacation_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VacationItem` ADD CONSTRAINT `VacationItem_vacationId_fkey` FOREIGN KEY (`vacationId`) REFERENCES `Vacation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_VacationTravelers` ADD CONSTRAINT `_VacationTravelers_A_fkey` FOREIGN KEY (`A`) REFERENCES `Member`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_VacationTravelers` ADD CONSTRAINT `_VacationTravelers_B_fkey` FOREIGN KEY (`B`) REFERENCES `Vacation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
