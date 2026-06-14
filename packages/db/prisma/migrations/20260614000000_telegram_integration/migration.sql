-- Telegram integration: a circle can link a Telegram group as an alternative to
-- WhatsApp. A single shared bot serves all circles; chat ids identify the group,
-- Telegram user ids identify senders. Link codes bind a group / admin account.

-- Group: the Telegram group chat id (parallels whatsappGroupId).
ALTER TABLE `Group` ADD COLUMN `telegramChatId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `Group_telegramChatId_key` ON `Group`(`telegramChatId`);

-- Member: Telegram user id (sender identity; not a phone, stored plain).
ALTER TABLE `Member` ADD COLUMN `tgId` VARCHAR(191) NULL;
CREATE INDEX `Member_circleId_tgId_idx` ON `Member`(`circleId`, `tgId`);

-- AuthUser: linked Telegram id + short-lived personal link code.
ALTER TABLE `AuthUser`
  ADD COLUMN `tgId` VARCHAR(191) NULL,
  ADD COLUMN `tgLinkCode` VARCHAR(191) NULL,
  ADD COLUMN `tgLinkExpires` DATETIME(3) NULL;
CREATE UNIQUE INDEX `AuthUser_tgId_key` ON `AuthUser`(`tgId`);
CREATE UNIQUE INDEX `AuthUser_tgLinkCode_key` ON `AuthUser`(`tgLinkCode`);

-- Circle: short-lived group link code.
ALTER TABLE `Circle`
  ADD COLUMN `tgLinkCode` VARCHAR(191) NULL,
  ADD COLUMN `tgLinkExpires` DATETIME(3) NULL;
CREATE UNIQUE INDEX `Circle_tgLinkCode_key` ON `Circle`(`tgLinkCode`);
