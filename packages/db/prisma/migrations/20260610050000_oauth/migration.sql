-- OAuth2 account linking (e.g. the Alexa skill): clients, auth codes, tokens.
CREATE TABLE `OAuthClient` (
  `id` VARCHAR(191) NOT NULL,
  `clientId` VARCHAR(191) NOT NULL,
  `secretHash` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `redirectUris` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `OAuthClient_clientId_key` (`clientId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OAuthAuthCode` (
  `id` VARCHAR(191) NOT NULL,
  `codeHash` VARCHAR(191) NOT NULL,
  `clientId` VARCHAR(191) NOT NULL,
  `authUserId` VARCHAR(191) NOT NULL,
  `redirectUri` TEXT NOT NULL,
  `codeChallenge` VARCHAR(191) NOT NULL,
  `codeChallengeMethod` VARCHAR(191) NOT NULL DEFAULT 'S256',
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `OAuthAuthCode_codeHash_key` (`codeHash`),
  INDEX `OAuthAuthCode_authUserId_idx` (`authUserId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OAuthToken` (
  `id` VARCHAR(191) NOT NULL,
  `clientId` VARCHAR(191) NOT NULL,
  `authUserId` VARCHAR(191) NOT NULL,
  `accessTokenHash` VARCHAR(191) NOT NULL,
  `refreshTokenHash` VARCHAR(191) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `OAuthToken_accessTokenHash_key` (`accessTokenHash`),
  UNIQUE INDEX `OAuthToken_refreshTokenHash_key` (`refreshTokenHash`),
  INDEX `OAuthToken_authUserId_idx` (`authUserId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OAuthAuthCode`
  ADD CONSTRAINT `OAuthAuthCode_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `OAuthClient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `OAuthAuthCode_authUserId_fkey` FOREIGN KEY (`authUserId`) REFERENCES `AuthUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `OAuthToken`
  ADD CONSTRAINT `OAuthToken_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `OAuthClient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `OAuthToken_authUserId_fkey` FOREIGN KEY (`authUserId`) REFERENCES `AuthUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
