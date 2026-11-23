CREATE TABLE IF NOT EXISTS `user` (
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE INDEX `IDX_638bac731294171648258260ff` (`password`),
  PRIMARY KEY (`email`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `login_state` (
  `loginState` varchar(255) NOT NULL,
  `expiredAt` datetime NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userEmail` varchar(255) NOT NULL,
  PRIMARY KEY (`loginState`, `userEmail`),
  CONSTRAINT `FK_26474c559c60af6912c9938771c` FOREIGN KEY (`userEmail`) REFERENCES `user`(`email`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `mercari_hunter` (
  `hunterInstanceId` varchar(255) NOT NULL,
  `freezingStart` time NULL,
  `freezingEnd` time NULL,
  `schedule` varchar(255) NOT NULL,
  `searchConditionSchema` longtext NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userEmail` varchar(255) NOT NULL,
  PRIMARY KEY (`hunterInstanceId`, `userEmail`),
  UNIQUE KEY `watcher_id` (`hunterInstanceId`),
  CONSTRAINT `FK_6767a322c33cd72f756b5a92345` FOREIGN KEY (`userEmail`) REFERENCES `user`(`email`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `mercari_goods_record` (
  `id` varchar(255) NOT NULL,
  `name` varchar(1500) NOT NULL,
  `price` varchar(255) NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `hunterHunterInstanceId` varchar(255) NOT NULL,
  PRIMARY KEY (`id`, `hunterHunterInstanceId`),
  CONSTRAINT `FK_f5c4fc20a22510e03d6eea29aca` FOREIGN KEY (`hunterHunterInstanceId`) REFERENCES `mercari_hunter`(`hunterInstanceId`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `yahoo_hunter` (
  `hunterInstanceId` varchar(255) NOT NULL,
  `freezingStart` time NULL,
  `freezingEnd` time NULL,
  `schedule` varchar(255) NOT NULL,
  `searchConditionSchema` longtext NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userEmail` varchar(255) NOT NULL,
  PRIMARY KEY (`hunterInstanceId`, `userEmail`),
  UNIQUE KEY `watcher_id` (`hunterInstanceId`),
  CONSTRAINT `FK_0f62b281b48fdeeb3d0d2379847` FOREIGN KEY (`userEmail`) REFERENCES `user`(`email`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `yahoo_auction_record` (
  `auctionId` varchar(255) NOT NULL,
  `auctionName` varchar(255) NOT NULL,
  `currentPrice` int NOT NULL,
  `buyNowPrice` int NULL,
  `currentBidCount` int NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `hunterHunterInstanceId` varchar(255) NOT NULL,
  PRIMARY KEY (`auctionId`, `hunterHunterInstanceId`),
  CONSTRAINT `FK_0bea50b5f5d35e1665584aa8c5c` FOREIGN KEY (`hunterHunterInstanceId`) REFERENCES `yahoo_hunter`(`hunterInstanceId`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `surugaya_hunter` (
  `hunterInstanceId` varchar(255) NOT NULL,
  `freezingStart` time NULL,
  `freezingEnd` time NULL,
  `schedule` varchar(255) NOT NULL,
  `searchConditionSchema` longtext NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userEmail` varchar(255) NOT NULL,
  PRIMARY KEY (`hunterInstanceId`, `userEmail`),
  UNIQUE KEY `watcher_id` (`hunterInstanceId`),
  CONSTRAINT `FK_160233e348dcc4632871f2a6dca` FOREIGN KEY (`userEmail`) REFERENCES `user`(`email`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `surugaya_goods_record` (
  `id` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `price` varchar(255) NULL,
  `marketPlacePrice` varchar(255) NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `hunterHunterInstanceId` varchar(255) NOT NULL,
  PRIMARY KEY (`id`, `hunterHunterInstanceId`),
  CONSTRAINT `FK_54127b313bc749dfaa9efb86710` FOREIGN KEY (`hunterHunterInstanceId`) REFERENCES `surugaya_hunter`(`hunterInstanceId`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `mandarake_hunter` (
  `hunterInstanceId` varchar(255) NOT NULL,
  `freezingStart` time NULL,
  `freezingEnd` time NULL,
  `schedule` varchar(255) NOT NULL,
  `searchConditionSchema` longtext NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userEmail` varchar(255) NOT NULL,
  PRIMARY KEY (`hunterInstanceId`, `userEmail`),
  UNIQUE KEY `watcher_id` (`hunterInstanceId`),
  CONSTRAINT `FK_28dc145f479cd60cf833e1c2fcf` FOREIGN KEY (`userEmail`) REFERENCES `user`(`email`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `mandarake_goods_record` (
  `id` varchar(255) NOT NULL,
  `name` varchar(1500) NOT NULL,
  `price` varchar(255) NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `hunterHunterInstanceId` varchar(255) NOT NULL,
  PRIMARY KEY (`id`, `hunterHunterInstanceId`),
  CONSTRAINT `FK_ad82cfb8f5ebfa3d885bd6a88e2` FOREIGN KEY (`hunterHunterInstanceId`) REFERENCES `mandarake_hunter`(`hunterInstanceId`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `surveillance_record` (
  `hunterInstanceId` varchar(255) NOT NULL,
  `searchConditionSchema` varchar(255) NOT NULL,
  `freezingStart` time NULL,
  `freezingEnd` time NULL,
  `schedule` varchar(255) NOT NULL,
  `snapshot` longtext NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userEmail` varchar(255) NOT NULL,
  PRIMARY KEY (`hunterInstanceId`, `userEmail`),
  CONSTRAINT `FK_0c1815562c0d2db0030334d9ea6` FOREIGN KEY (`userEmail`) REFERENCES `user`(`email`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `yahoo_fleamarket_hunter` (
  `hunterInstanceId` varchar(255) NOT NULL,
  `freezingStart` time NULL,
  `freezingEnd` time NULL,
  `schedule` varchar(255) NOT NULL,
  `searchConditionSchema` longtext NOT NULL,
  `initialized` tinyint NOT NULL DEFAULT 0,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userEmail` varchar(255) NOT NULL,
  PRIMARY KEY (`hunterInstanceId`),
  CONSTRAINT `FK_4a7867ef34dce981956eb3d7202` FOREIGN KEY (`userEmail`) REFERENCES `user`(`email`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `yahoo_fleamarket_goods_record` (
  `id` varchar(200) NOT NULL,
  `name` text NOT NULL,
  `price` bigint NOT NULL,
  `thumbnailImageUrl` text NOT NULL,
  `itemUrl` text NOT NULL,
  `status` varchar(255) NOT NULL,
  `openTime` varchar(255) NULL,
  `notificationPending` tinyint NOT NULL DEFAULT 0,
  `notifiedAt` datetime NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `hunterInstanceId` varchar(255) NOT NULL,
  PRIMARY KEY (`id`, `hunterInstanceId`),
  CONSTRAINT `FK_6901cb763e29e204e052fb64d46` FOREIGN KEY (`hunterInstanceId`) REFERENCES `yahoo_fleamarket_hunter`(`hunterInstanceId`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `xianyu_hunter` (
  `hunterInstanceId` varchar(255) NOT NULL,
  `freezingStart` time NULL,
  `freezingEnd` time NULL,
  `schedule` varchar(255) NOT NULL,
  `searchConditionSchema` longtext NOT NULL,
  `initialized` tinyint NOT NULL DEFAULT 0,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userEmail` varchar(255) NOT NULL,
  PRIMARY KEY (`hunterInstanceId`),
  CONSTRAINT `FK_d12c668ba0785ac88a985554bc3` FOREIGN KEY (`userEmail`) REFERENCES `user`(`email`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `xianyu_goods_record` (
  `id` varchar(200) NOT NULL,
  `name` text NOT NULL,
  `priceFen` bigint NOT NULL,
  `thumbnailImageUrl` text NOT NULL,
  `itemUrl` text NOT NULL,
  `publishedAt` varchar(255) NULL,
  `notificationPending` tinyint NOT NULL DEFAULT 0,
  `notifiedAt` datetime NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `hunterInstanceId` varchar(255) NOT NULL,
  PRIMARY KEY (`id`, `hunterInstanceId`),
  CONSTRAINT `FK_953020bad88670b5108a8a3cfd1` FOREIGN KEY (`hunterInstanceId`) REFERENCES `xianyu_hunter`(`hunterInstanceId`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `search_scan_record` (
  `id` int NOT NULL AUTO_INCREMENT,
  `site` varchar(24) NOT NULL,
  `outcome` varchar(32) NOT NULL,
  `completedAt` datetime(3) NOT NULL,
  INDEX `IDX_ace3807a3fa644c2b5e01c69ad` (`completedAt`),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `active_search_mode` (
  `userEmail` varchar(255) NOT NULL,
  PRIMARY KEY (`userEmail`),
  FOREIGN KEY (`userEmail`) REFERENCES `user`(`email`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `active_search_product` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `userEmail` varchar(255) NOT NULL,
  `site` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `itemId` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `item` json NOT NULL,
  `foundAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `viewed` tinyint NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY (`userEmail`,`site`,`itemId`),
  KEY (`userEmail`,`viewed`,`foundAt`,`id`),
  FOREIGN KEY (`userEmail`) REFERENCES `user`(`email`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
