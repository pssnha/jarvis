-- DropIndex
DROP INDEX `Member_waId_idx` ON `Member`;

-- AlterTable
ALTER TABLE `AuthUser` ADD COLUMN `waEnc` VARCHAR(191) NULL,
    ADD COLUMN `waHash` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Member` DROP COLUMN `waId`,
    ADD COLUMN `waEnc` TEXT NULL,
    ADD COLUMN `waHash` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `AuthUser_waHash_key` ON `AuthUser`(`waHash`);

-- CreateIndex
CREATE INDEX `Member_waHash_idx` ON `Member`(`waHash`);

