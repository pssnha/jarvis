-- Circle re-architecture: introduce Circle as the top entity; Group becomes a
-- child WhatsApp group; Members/Events/Vacations/Proposals/Conversations re-scope
-- to circleId; private events via ownerMemberId; drop maintenance Group + email
-- on Group. Ordered: additive DDL -> data backfill/dedupe/cleanup -> destructive DDL.

-- ===================== 1) New tables =====================
CREATE TABLE `Circle` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'UTC',
    `waSelf` VARCHAR(191) NULL,
    `emailAddress` VARCHAR(191) NULL,
    `emailEncCred` TEXT NULL,
    `emailHost` VARCHAR(191) NULL,
    `emailPort` INTEGER NULL,
    `emailEnabled` BOOLEAN NOT NULL DEFAULT false,
    `emailFirstScanDone` BOOLEAN NOT NULL DEFAULT false,
    `emailLastUid` INTEGER NULL,
    `emailLastPolledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Circle_emailAddress_key`(`emailAddress`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `GroupMember` (
    `groupId` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `GroupMember_memberId_idx`(`memberId`),
    PRIMARY KEY (`groupId`, `memberId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CircleMutedJob` (
    `circleId` VARCHAR(191) NOT NULL,
    `job` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`circleId`, `job`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ===================== 2) Additive columns (nullable) =====================
ALTER TABLE `Group` ADD COLUMN `circleId` VARCHAR(191) NULL;
ALTER TABLE `Member` ADD COLUMN `circleId` VARCHAR(191) NULL;
ALTER TABLE `Vacation` ADD COLUMN `circleId` VARCHAR(191) NULL;
ALTER TABLE `EmailProposal` ADD COLUMN `circleId` VARCHAR(191) NULL;
ALTER TABLE `Event` ADD COLUMN `circleId` VARCHAR(191) NULL, ADD COLUMN `ownerMemberId` VARCHAR(191) NULL, MODIFY `groupId` VARCHAR(191) NULL;
ALTER TABLE `Conversation` ADD COLUMN `circleId` VARCHAR(191) NULL, ADD COLUMN `memberId` VARCHAR(191) NULL, MODIFY `groupId` VARCHAR(191) NULL;

-- ===================== 3) Data migration =====================
-- 3a) One circle from the real (non-maintenance) group; prefer one with email.
INSERT INTO `Circle` (`id`,`name`,`timezone`,`emailAddress`,`emailEncCred`,`emailHost`,`emailPort`,`emailEnabled`,`emailFirstScanDone`,`emailLastUid`,`emailLastPolledAt`,`createdAt`,`updatedAt`)
SELECT 'circle_passanha','Passanha Family',`timezone`,`emailAddress`,`emailEncCred`,`emailHost`,`emailPort`,`emailEnabled`,`emailFirstScanDone`,`emailLastUid`,`emailLastPolledAt`,NOW(3),NOW(3)
FROM `Group`
WHERE `kind` <> 'maintenance'
ORDER BY (`emailAddress` IS NOT NULL) DESC, `createdAt` ASC
LIMIT 1;

-- 3b) Point real groups + their rows at the circle.
UPDATE `Group` SET `circleId`='circle_passanha' WHERE `kind` <> 'maintenance';
UPDATE `Member` m JOIN `Group` g ON m.`groupId`=g.`id` SET m.`circleId`='circle_passanha' WHERE g.`kind` <> 'maintenance';
UPDATE `Event` e JOIN `Group` g ON e.`groupId`=g.`id` SET e.`circleId`='circle_passanha' WHERE g.`kind` <> 'maintenance';
UPDATE `Vacation` v JOIN `Group` g ON v.`groupId`=g.`id` SET v.`circleId`='circle_passanha' WHERE g.`kind` <> 'maintenance';
UPDATE `EmailProposal` p JOIN `Group` g ON p.`groupId`=g.`id` SET p.`circleId`='circle_passanha' WHERE g.`kind` <> 'maintenance';
UPDATE `Conversation` c JOIN `Group` g ON c.`groupId`=g.`id` SET c.`circleId`='circle_passanha' WHERE g.`kind` <> 'maintenance';

-- 3c) Group membership from the old 1:1 Member.groupId (real groups only).
INSERT INTO `GroupMember` (`groupId`,`memberId`,`createdAt`)
SELECT m.`groupId`, m.`id`, m.`createdAt` FROM `Member` m JOIN `Group` g ON m.`groupId`=g.`id` WHERE g.`kind` <> 'maintenance';

-- 3d) Delete the maintenance group (cascades its events/members/etc via existing FKs).
DELETE FROM `Group` WHERE `kind` = 'maintenance';

-- 3e) Dedupe members by waHash within the circle (keep the lowest id). Repoint FKs.
-- Drop colliding GroupMember / traveler rows first, then repoint, then delete dups.
DELETE gm FROM `GroupMember` gm
  JOIN `Member` dup ON gm.`memberId`=dup.`id` AND dup.`waHash` IS NOT NULL
  JOIN (SELECT `circleId`,`waHash`, MIN(`id`) AS keepId FROM `Member` WHERE `waHash` IS NOT NULL GROUP BY `circleId`,`waHash`) k
    ON k.`circleId`=dup.`circleId` AND k.`waHash`=dup.`waHash`
  JOIN `GroupMember` ex ON ex.`memberId`=k.keepId AND ex.`groupId`=gm.`groupId`
  WHERE dup.`id` <> k.keepId;
UPDATE `GroupMember` gm
  JOIN `Member` dup ON gm.`memberId`=dup.`id` AND dup.`waHash` IS NOT NULL
  JOIN (SELECT `circleId`,`waHash`, MIN(`id`) AS keepId FROM `Member` WHERE `waHash` IS NOT NULL GROUP BY `circleId`,`waHash`) k
    ON k.`circleId`=dup.`circleId` AND k.`waHash`=dup.`waHash`
  SET gm.`memberId`=k.keepId WHERE dup.`id` <> k.keepId;
DELETE vt FROM `_VacationTravelers` vt
  JOIN `Member` dup ON vt.`A`=dup.`id` AND dup.`waHash` IS NOT NULL
  JOIN (SELECT `circleId`,`waHash`, MIN(`id`) AS keepId FROM `Member` WHERE `waHash` IS NOT NULL GROUP BY `circleId`,`waHash`) k
    ON k.`circleId`=dup.`circleId` AND k.`waHash`=dup.`waHash`
  JOIN `_VacationTravelers` ex ON ex.`A`=k.keepId AND ex.`B`=vt.`B`
  WHERE dup.`id` <> k.keepId;
UPDATE `_VacationTravelers` vt
  JOIN `Member` dup ON vt.`A`=dup.`id` AND dup.`waHash` IS NOT NULL
  JOIN (SELECT `circleId`,`waHash`, MIN(`id`) AS keepId FROM `Member` WHERE `waHash` IS NOT NULL GROUP BY `circleId`,`waHash`) k
    ON k.`circleId`=dup.`circleId` AND k.`waHash`=dup.`waHash`
  SET vt.`A`=k.keepId WHERE dup.`id` <> k.keepId;
UPDATE `Event` e
  JOIN `Member` dup ON e.`createdById`=dup.`id` AND dup.`waHash` IS NOT NULL
  JOIN (SELECT `circleId`,`waHash`, MIN(`id`) AS keepId FROM `Member` WHERE `waHash` IS NOT NULL GROUP BY `circleId`,`waHash`) k
    ON k.`circleId`=dup.`circleId` AND k.`waHash`=dup.`waHash`
  SET e.`createdById`=k.keepId WHERE dup.`id` <> k.keepId;
UPDATE `Event` e
  JOIN `Member` dup ON e.`assigneeId`=dup.`id` AND dup.`waHash` IS NOT NULL
  JOIN (SELECT `circleId`,`waHash`, MIN(`id`) AS keepId FROM `Member` WHERE `waHash` IS NOT NULL GROUP BY `circleId`,`waHash`) k
    ON k.`circleId`=dup.`circleId` AND k.`waHash`=dup.`waHash`
  SET e.`assigneeId`=k.keepId WHERE dup.`id` <> k.keepId;
DELETE m FROM `Member` m
  JOIN (SELECT `circleId`,`waHash`, MIN(`id`) AS keepId FROM `Member` WHERE `waHash` IS NOT NULL GROUP BY `circleId`,`waHash`) k
    ON k.`circleId`=m.`circleId` AND k.`waHash`=m.`waHash`
  WHERE m.`waHash` IS NOT NULL AND m.`id` <> k.keepId;

-- 3f) Any members/rows still without a circle (e.g. orphaned) are unmigratable — delete.
DELETE FROM `Member` WHERE `circleId` IS NULL;
DELETE FROM `Event` WHERE `circleId` IS NULL;
DELETE FROM `Vacation` WHERE `circleId` IS NULL;
DELETE FROM `EmailProposal` WHERE `circleId` IS NULL;
DELETE FROM `Conversation` WHERE `circleId` IS NULL;
DELETE FROM `Group` WHERE `circleId` IS NULL;

-- ===================== 4) Destructive DDL =====================
ALTER TABLE `EmailProposal` DROP FOREIGN KEY `EmailProposal_groupId_fkey`;
ALTER TABLE `Event` DROP FOREIGN KEY `Event_maintainsGroupId_fkey`;
ALTER TABLE `Member` DROP FOREIGN KEY `Member_groupId_fkey`;
ALTER TABLE `Vacation` DROP FOREIGN KEY `Vacation_groupId_fkey`;

DROP INDEX `EmailProposal_groupId_status_idx` ON `EmailProposal`;
DROP INDEX `Event_maintainsGroupId_fkey` ON `Event`;
DROP INDEX `Group_emailAddress_key` ON `Group`;
DROP INDEX `Member_groupId_idx` ON `Member`;
DROP INDEX `Vacation_groupId_startDate_idx` ON `Vacation`;

ALTER TABLE `EmailProposal` DROP COLUMN `groupId`, MODIFY `circleId` VARCHAR(191) NOT NULL;
ALTER TABLE `Event` DROP COLUMN `maintainsGroupId`, MODIFY `circleId` VARCHAR(191) NOT NULL;
ALTER TABLE `Vacation` DROP COLUMN `groupId`, MODIFY `circleId` VARCHAR(191) NOT NULL;
ALTER TABLE `Member` DROP COLUMN `groupId`, MODIFY `circleId` VARCHAR(191) NOT NULL;
ALTER TABLE `Conversation` MODIFY `circleId` VARCHAR(191) NOT NULL;
ALTER TABLE `Group`
  DROP COLUMN `emailAddress`, DROP COLUMN `emailEnabled`, DROP COLUMN `emailEncCred`,
  DROP COLUMN `emailFirstScanDone`, DROP COLUMN `emailHost`, DROP COLUMN `emailLastPolledAt`,
  DROP COLUMN `emailLastUid`, DROP COLUMN `emailPort`, DROP COLUMN `kind`, DROP COLUMN `timezone`,
  MODIFY `circleId` VARCHAR(191) NOT NULL;

-- ===================== 5) New indexes =====================
CREATE INDEX `Conversation_circleId_channel_idx` ON `Conversation`(`circleId`, `channel`);
CREATE INDEX `Conversation_memberId_idx` ON `Conversation`(`memberId`);
CREATE INDEX `EmailProposal_circleId_status_idx` ON `EmailProposal`(`circleId`, `status`);
CREATE INDEX `Event_circleId_startsAt_idx` ON `Event`(`circleId`, `startsAt`);
CREATE INDEX `Event_ownerMemberId_startsAt_idx` ON `Event`(`ownerMemberId`, `startsAt`);
CREATE INDEX `Group_circleId_idx` ON `Group`(`circleId`);
CREATE INDEX `Member_circleId_idx` ON `Member`(`circleId`);
CREATE INDEX `Vacation_circleId_startDate_idx` ON `Vacation`(`circleId`, `startDate`);

-- ===================== 6) New foreign keys =====================
ALTER TABLE `Group` ADD CONSTRAINT `Group_circleId_fkey` FOREIGN KEY (`circleId`) REFERENCES `Circle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Member` ADD CONSTRAINT `Member_circleId_fkey` FOREIGN KEY (`circleId`) REFERENCES `Circle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `GroupMember` ADD CONSTRAINT `GroupMember_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `GroupMember` ADD CONSTRAINT `GroupMember_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `Member`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Event` ADD CONSTRAINT `Event_circleId_fkey` FOREIGN KEY (`circleId`) REFERENCES `Circle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Event` ADD CONSTRAINT `Event_ownerMemberId_fkey` FOREIGN KEY (`ownerMemberId`) REFERENCES `Member`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Vacation` ADD CONSTRAINT `Vacation_circleId_fkey` FOREIGN KEY (`circleId`) REFERENCES `Circle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `EmailProposal` ADD CONSTRAINT `EmailProposal_circleId_fkey` FOREIGN KEY (`circleId`) REFERENCES `Circle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_circleId_fkey` FOREIGN KEY (`circleId`) REFERENCES `Circle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `Member`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CircleMutedJob` ADD CONSTRAINT `CircleMutedJob_circleId_fkey` FOREIGN KEY (`circleId`) REFERENCES `Circle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
