-- Sign-up step 2 now lets the applicant pick a messaging channel (WhatsApp or
-- Telegram) instead of always requiring a WhatsApp number. The other channel can
-- be added later from the admin Connections panel.
ALTER TABLE `CircleSignup` ADD COLUMN `channel` VARCHAR(191) NULL;
