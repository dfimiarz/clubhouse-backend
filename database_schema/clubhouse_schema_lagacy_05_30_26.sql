
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `clubhouse` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `clubhouse`;
DROP TABLE IF EXISTS `activities_view`;
/*!50001 DROP VIEW IF EXISTS `activities_view`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `activities_view` AS SELECT 
 1 AS `id`,
 1 AS `start`,
 1 AS `end`,
 1 AS `details`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `activity`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `activity` (
  `id` int NOT NULL AUTO_INCREMENT,
  `created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `type` int NOT NULL,
  `court` int NOT NULL,
  `date` date NOT NULL,
  `start` time NOT NULL,
  `end` time NOT NULL,
  `bumpable` tinyint(1) NOT NULL DEFAULT '0',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `notes` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `court_fk_idx` (`court`),
  KEY `gametype_fk_idx` (`type`),
  KEY `starttime` (`start`),
  KEY `endtime` (`end`),
  KEY `date` (`date`),
  CONSTRAINT `activity_act_type_fk` FOREIGN KEY (`type`) REFERENCES `activity_type` (`id`),
  CONSTRAINT `activity_court_fk` FOREIGN KEY (`court`) REFERENCES `court` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=17025 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `activity_group`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `activity_group` (
  `id` int NOT NULL,
  `name` varchar(64) NOT NULL,
  `label` varchar(32) NOT NULL,
  `utility_factor` smallint NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `activity_supported`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `activity_supported` (
  `court` int NOT NULL,
  `activity_type` int NOT NULL,
  PRIMARY KEY (`court`,`activity_type`),
  KEY `court_activity_type_fk_idx` (`activity_type`),
  CONSTRAINT `court_activity_court_fk` FOREIGN KEY (`court`) REFERENCES `court` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `court_activity_type_fk` FOREIGN KEY (`activity_type`) REFERENCES `activity_type` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `activity_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `activity_type` (
  `id` int NOT NULL,
  `group` int NOT NULL,
  `lbl` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `desc` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `restricted` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `activity_activity_group_fk_idx` (`group`),
  CONSTRAINT `activity_activity_group_fk` FOREIGN KEY (`group`) REFERENCES `activity_group` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `club`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `time_zone` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `guest_reg_limit` int NOT NULL DEFAULT '6',
  `default_cal_start` time NOT NULL DEFAULT '08:00:00',
  `default_cal_end` time NOT NULL DEFAULT '20:00:00',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `club_schedule`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_schedule` (
  `id` int NOT NULL AUTO_INCREMENT,
  `club` int NOT NULL,
  `name` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `from` date NOT NULL,
  `to` date NOT NULL,
  PRIMARY KEY (`id`),
  KEY `schedule_club_fk_idx` (`club`),
  CONSTRAINT `schedule_club_fk` FOREIGN KEY (`club`) REFERENCES `club` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `club_seasons`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_seasons` (
  `id` int NOT NULL,
  `club` int NOT NULL,
  `name` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `start` date NOT NULL,
  `end` date NOT NULL,
  PRIMARY KEY (`id`),
  KEY `club_seaons_club_fk_idx` (`club`),
  CONSTRAINT `club_seaons_club_fk` FOREIGN KEY (`club`) REFERENCES `club` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `court`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `court` (
  `id` int NOT NULL,
  `club` int NOT NULL,
  `name` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  PRIMARY KEY (`id`),
  KEY `club_fk_idx` (`club`),
  CONSTRAINT `court_club_fk` FOREIGN KEY (`club`) REFERENCES `club` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `court_schedule_item`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `court_schedule_item` (
  `id` int NOT NULL AUTO_INCREMENT,
  `schedule` int NOT NULL,
  `court` int NOT NULL,
  `dayofweek` smallint NOT NULL,
  `open` time NOT NULL,
  `close` time NOT NULL,
  `message` text,
  PRIMARY KEY (`id`),
  KEY `court_schedule_court_fk_idx` (`court`),
  KEY `court_schedule_id_fk_idx` (`schedule`),
  CONSTRAINT `court_schedule_id_fk` FOREIGN KEY (`schedule`) REFERENCES `club_schedule` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `court_schedule_item_court_fk` FOREIGN KEY (`court`) REFERENCES `court` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `gender`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gender` (
  `id` varchar(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `label` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `guest_pass`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `guest_pass` (
  `id` int NOT NULL AUTO_INCREMENT,
  `created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `guest_id` int NOT NULL,
  `member_id` int NOT NULL,
  `valid` tinyint(1) NOT NULL DEFAULT '1',
  `type` int NOT NULL,
  `valid_from` datetime NOT NULL,
  `valid_to` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `host_member_record_fk_idx` (`member_id`),
  KEY `host_guest_record_fk_idx` (`guest_id`),
  KEY `pass_type_fk_idx` (`type`),
  KEY `gp_valid_from` (`valid_from`),
  KEY `gp_valid_to` (`valid_to`),
  CONSTRAINT `host_guest_record_fk` FOREIGN KEY (`guest_id`) REFERENCES `person` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `host_member_record_fk` FOREIGN KEY (`member_id`) REFERENCES `person` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `pass_type_fk` FOREIGN KEY (`type`) REFERENCES `guest_pass_type` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1523 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `guest_pass_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `guest_pass_type` (
  `id` int NOT NULL,
  `club_id` int NOT NULL,
  `label` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `valid_days` int NOT NULL DEFAULT '1',
  `season_limit` int NOT NULL DEFAULT '0',
  `cost` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `gpt_club_id_fk_idx` (`club_id`),
  CONSTRAINT `gpt_club_id_fk` FOREIGN KEY (`club_id`) REFERENCES `club` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `membership`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `membership` (
  `record_id` int NOT NULL AUTO_INCREMENT,
  `person_id` int NOT NULL,
  `valid_from` date NOT NULL,
  `valid_until` date NOT NULL,
  `role` int NOT NULL DEFAULT '2000',
  PRIMARY KEY (`record_id`),
  KEY `membership_role_fk_idx` (`role`),
  KEY `membership_person_id_idx` (`person_id`),
  CONSTRAINT `member_person_id` FOREIGN KEY (`person_id`) REFERENCES `person` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `member_role_fk` FOREIGN KEY (`role`) REFERENCES `role` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=807 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `bi_membership_check_valid_period` BEFORE INSERT ON `membership` FOR EACH ROW BEGIN
	IF NEW.valid_from >= NEW.valid_until THEN
		SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Incorrect membership date range';
    END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `bi_membership_check_valid_overlap` BEFORE INSERT ON `membership` FOR EACH ROW BEGIN
	DECLARE _overlaps INT;
	SELECT exists (SELECT record_id from membership where person_id = NEW.person_id and valid_from < NEW.valid_until AND valid_until > NEW.valid_from) INTO _overlaps;
    
    IF _overlaps = 1 THEN
		SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'User roles cannot overlap';
    END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `bu_membership_check_valid_period` BEFORE UPDATE ON `membership` FOR EACH ROW BEGIN
	IF NEW.valid_from >= NEW.valid_until THEN
		SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Incorrect membership date range';
    END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `bu_membership_check_valid_overlap` BEFORE UPDATE ON `membership` FOR EACH ROW BEGIN
	DECLARE _overlaps INT;
	SELECT exists (SELECT record_id from membership where person_id = NEW.person_id and valid_from < NEW.valid_until AND valid_until > NEW.valid_from and record_id <> NEW.record_id) INTO _overlaps;

    IF _overlaps = 1 THEN
		SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'User roles cannot overlap';
    END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `membership_view`;
/*!50001 DROP VIEW IF EXISTS `membership_view`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `membership_view` AS SELECT 
 1 AS `id`,
 1 AS `firstname`,
 1 AS `lastname`,
 1 AS `email`,
 1 AS `club`,
 1 AS `valid_from`,
 1 AS `valid_until`,
 1 AS `role`,
 1 AS `role_name`,
 1 AS `role_type_id`,
 1 AS `role_type_name`,
 1 AS `guest_host`,
 1 AS `event_host`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `participant`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `participant` (
  `id` int NOT NULL AUTO_INCREMENT,
  `activity` int NOT NULL,
  `person` int NOT NULL,
  `status` int NOT NULL,
  `type` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `player_activity_unique` (`activity`,`person`),
  KEY `player_member_id_fk_idx` (`person`),
  KEY `player_activity_fk` (`activity`),
  KEY `player_type_id_fk_idx` (`type`),
  CONSTRAINT `participant_activity_fk` FOREIGN KEY (`activity`) REFERENCES `activity` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `participant_person_id_fk` FOREIGN KEY (`person`) REFERENCES `person` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `participant_type_id_fk` FOREIGN KEY (`type`) REFERENCES `participant_type` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=34468 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `participant_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `participant_type` (
  `id` int NOT NULL,
  `desc` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `lbl` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `payment_processors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_processors` (
  `id` int NOT NULL,
  `name` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `default_config` json NOT NULL,
  `validator` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `payment_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_types` (
  `id` int NOT NULL,
  `club` int NOT NULL,
  `name` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `processor` int NOT NULL,
  `fee` int NOT NULL,
  `fee_type` varchar(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `processor_config` json NOT NULL,
  PRIMARY KEY (`id`),
  KEY `payment_type_club_fk_idx` (`club`),
  KEY `payment_type_processor_fk_idx` (`processor`),
  CONSTRAINT `payment_type_club_fk` FOREIGN KEY (`club`) REFERENCES `club` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `payment_type_processor_fk` FOREIGN KEY (`processor`) REFERENCES `payment_processors` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `person`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `person` (
  `id` int NOT NULL AUTO_INCREMENT,
  `club` int NOT NULL,
  `created` date NOT NULL,
  `firstname` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `lastname` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `email` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `phone` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `gender` varchar(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'N',
  `note` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `person_uniq` (`club`,`email`),
  KEY `person_club_fk_idx` (`club`),
  KEY `person_person_gender_fk_idx` (`gender`),
  CONSTRAINT `person_club_fk` FOREIGN KEY (`club`) REFERENCES `club` (`id`),
  CONSTRAINT `person_person_gender_fk` FOREIGN KEY (`gender`) REFERENCES `gender` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1440 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `role`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `role` (
  `id` int NOT NULL,
  `lbl` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `type` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `role_type_id_fk_idx` (`type`),
  CONSTRAINT `role_type_id_fk` FOREIGN KEY (`type`) REFERENCES `role_type` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `role_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `role_type` (
  `id` int NOT NULL,
  `label` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `guest_host` tinyint(1) NOT NULL DEFAULT '0',
  `event_host` tinyint(1) DEFAULT NULL COMMENT 'Can host events',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 DROP FUNCTION IF EXISTS `getClubTime` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` FUNCTION `getClubTime`(t datetime, z varchar(64)) RETURNS datetime
    NO SQL
return convert_tz(t,@@GLOBAL.time_zone,z) ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP FUNCTION IF EXISTS `getDbTime` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` FUNCTION `getDbTime`(t datetime, z varchar(64)) RETURNS datetime
    NO SQL
return convert_tz(t,z,@@GLOBAL.time_zone) ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `addGuest` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `addGuest`(IN _club INT,IN _hostemail VARCHAR(64),IN _firstname VARCHAR(32),IN _lastname VARCHAR(32), IN _email VARCHAR(64), IN _phone VARCHAR(32), IN _family INT(1))
BEGIN
	#Guest ID
	DECLARE gid INT;
    #Member ID
    DECLARE mid INT;
    #Count 
    DECLARE gcount INT;
    #Limit
    DECLARE reg_limit INT;
    
    DECLARE EXIT HANDLER FOR SQLEXCEPTION, SQLWARNING
		BEGIN
			ROLLBACK;
			RESIGNAL;
		END;
    
    START TRANSACTION;
    
    #Get guest registration limit/guest
    BEGIN
		DECLARE EXIT HANDLER FOR NOT FOUND
		  BEGIN
			SIGNAL SQLSTATE '45000'
			SET MESSAGE_TEXT = 'Invalid club', MYSQL_ERRNO = 1001;
		  END;
    
		SELECT guest_reg_limit into reg_limit FROM `club` where id = _club LOCK IN SHARE MODE;
    END;
    
    #Check if hostemail is valid
    BEGIN
		DECLARE EXIT HANDLER FOR NOT FOUND
		  BEGIN
			SIGNAL SQLSTATE '45000'
			SET MESSAGE_TEXT = 'Invalid host email', MYSQL_ERRNO = 1002;
		  END;
    
		SELECT id into mid FROM `person` where email = _hostemail and type = 1 lock in share mode;
    END;
    
    #Check for registration limit vilotion
    BEGIN
		SELECT COUNT(*) FROM `person` p JOIN `guest` g ON g.person_id = p.id WHERE p.created = curdate() AND p.type = 2 AND g.member = mid INTO gcount;
        
        IF gcount >= reg_limit THEN
			SIGNAL SQLSTATE '45000'
			SET MESSAGE_TEXT = 'Guest registration limit reached', MYSQL_ERRNO = 1003;
        END IF;
    END;
	
    BEGIN
		DECLARE duplicate_key CONDITION FOR 1062;
		DECLARE EXIT HANDLER FOR duplicate_key
			BEGIN
				SIGNAL SQLSTATE '45000'
				SET MESSAGE_TEXT = 'Person already exists', MYSQL_ERRNO = 1004;
			END;
            
		INSERT INTO `person` (`type`,club,created,firstname,lastname,email,phone) values (2,_club,CURDATE(),_firstname,_lastname,_email,_phone);
	END;
    
    SET gid = LAST_INSERT_ID();
	
   	INSERT INTO `guest` (`person_id`, `member`, `family`) VALUES (gid, mid, _family);
   
	COMMIT;


END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `addMatch` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `addMatch`(IN _type INT,IN _court INT,IN _date DATE,IN _start TIME, IN _end TIME, IN _bumpable TINYINT , IN _notes VARCHAR(256), IN _players JSON)
BEGIN
	DECLARE start_dt DATETIME;
	DECLARE end_dt DATETIME;
	DECLARE overlap INT;
	DECLARE i INT DEFAULT 0;
	DECLARE numplayers INT DEFAULT 0;
	DECLARE matchid INT;
	DECLARE schedule_lock INT;
	DECLARE EXIT HANDLER FOR SQLEXCEPTION, SQLWARNING
		BEGIN
			ROLLBACK;
			# Release operation lock
			DO RELEASE_LOCK('clubhouse_schedule_lock');
			RESIGNAL;
		END;

	# Check if start and end are at least 1 min apart
	IF TIME_TO_SEC(_end) - (TIME_TO_SEC(_start) + 60) <= 0 THEN
		SIGNAL SQLSTATE '45000'
		SET MESSAGE_TEXT = 'Start and End must be at least 1 min apart';
	END IF;
  
	SELECT GET_LOCK('clubhouse_schedule_lock', 1) INTO schedule_lock;
	   
	IF schedule_lock <> 1 THEN
		SIGNAL SQLSTATE '45000'
		SET MESSAGE_TEXT = 'Could not obtain schedule lock';
	END IF;
   
	SELECT 
    COUNT(*)
INTO overlap FROM
    activity
WHERE
    _end > start AND _start < end
        AND court = _court
        AND date = _date
        AND active = 1;
 
	IF overlap > 0 THEN
		SIGNAL SQLSTATE '45000'
		SET MESSAGE_TEXT = 'Overlapping session found. Check schedule';
    END IF;
   
    IF JSON_VALID(_players) = 0 THEN
		SIGNAL SQLSTATE '45000'
		SET MESSAGE_TEXT = 'Bad player info';
    END IF;

	IF JSON_TYPE(_players) <> 'ARRAY' THEN
		SIGNAL SQLSTATE '45000'
		SET MESSAGE_TEXT = 'Bad player info';
	END IF;
	   
	SET numplayers = JSON_LENGTH(_players);
	   
	IF numplayers < 1 OR numplayers > 4 THEN
		SIGNAL SQLSTATE '45000'
		SET MESSAGE_TEXT = 'Wrong number of players';
	END IF;
     
	START TRANSACTION;
	
    INSERT INTO `activity` (`id`, `created`, `updated`, `type`, `court`, `date` ,`start`, `end`, `bumpable`,`active`,`notes`) VALUES (NULL, null, NULL, _type, _court, _date,_start, _end, _bumpable ,1,_notes);
   
    SET matchid = LAST_INSERT_ID();
   
	WHILE i < numplayers DO
		IF JSON_CONTAINS_PATH(JSON_EXTRACT(_players,CONCAT('$[',i,']')),'all','$.id','$.type') = 0 THEN
			SIGNAL SQLSTATE '45000'
			SET MESSAGE_TEXT = 'Wrong player data';
		END IF;
		   
		INSERT INTO `participant` (`id`, `activity`, `person`, `status`, `type`)
		VALUES (null, matchid , JSON_UNQUOTE(JSON_EXTRACT(_players,CONCAT('$[',i,'].id')))  ,  1 , JSON_UNQUOTE(JSON_EXTRACT(_players,CONCAT('$[',i,'].type'))));
		   
		SET i = i + 1;
    END WHILE;
   
    COMMIT;
   
    # Release operation lock
    DO RELEASE_LOCK('clubhouse_schedule_lock');
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `addmember` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ALLOW_INVALID_DATES,ERROR_FOR_DIVISION_BY_ZERO,TRADITIONAL,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `addmember`(	
	in club int,
	in firstname varchar(45),
    in lastname varchar(45),
    in email varchar(45),
    in phone varchar(32),
    in gender varchar(1), 
    in pin varchar(4),
    in role int,
    in active bool)
BEGIN
	DECLARE pid INT;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION, SQLWARNING
		BEGIN
			ROLLBACK;
			RESIGNAL;
		END;
        
	START TRANSACTION;
	
    BEGIN
		DECLARE duplicate_key CONDITION FOR 1062;
		DECLARE EXIT HANDLER FOR duplicate_key
			BEGIN
				ROLLBACK;
				SIGNAL SQLSTATE '45000'
				SET MESSAGE_TEXT = 'Person already exists', MYSQL_ERRNO = 1002;
			END;
		
		insert into person values (null,1,club,CURDATE(),firstname,lastname,email,phone,gender);
	END;
    
    SET pid = LAST_INSERT_ID();
	
    BEGIN
		DECLARE duplicate_key CONDITION FOR 1062;
		DECLARE EXIT HANDLER FOR duplicate_key
			BEGIN
				ROLLBACK;
				SIGNAL SQLSTATE '45000'
				SET MESSAGE_TEXT = 'Username already exists', MYSQL_ERRNO = 1003;
			END;
		insert into member values (pid,CURDATE(),now(),null,null,pin,active,role);
    END;
    COMMIT;
    
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `changeActivityCourt` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `changeActivityCourt`(IN _id INT, IN _hash VARCHAR(32),IN _date DATE,IN _start TIME,IN _end TIME,IN _new_court INT)
BEGIN

DECLARE schedule_lock INT;
DECLARE overlap INT;

DECLARE EXIT HANDLER FOR SQLEXCEPTION, SQLWARNING
		BEGIN
			# Release operation lock
			DO RELEASE_LOCK('clubhouse_schedule_lock');
			RESIGNAL;
		END;

SELECT GET_LOCK('clubhouse_schedule_lock', 1) INTO schedule_lock;
	   
IF schedule_lock <> 1 THEN
	SIGNAL SQLSTATE '45000'
	SET MESSAGE_TEXT = 'Could not obtain schedule lock';
END IF;

SELECT 
	COUNT(*)
INTO overlap FROM
	activity
WHERE
	_end > start 
    AND _start < end
	AND court = _new_court
	AND date = _date
	AND active = 1;
 
IF overlap > 0 THEN
	SIGNAL SQLSTATE '45000'
	SET MESSAGE_TEXT = 'Overlapping session';
END IF;

UPDATE activity set court = _new_court WHERE id = _id; 

# Release operation lock
DO RELEASE_LOCK('clubhouse_schedule_lock');

END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `changeActivityTime` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `changeActivityTime`(IN _id INT,IN _hash VARCHAR(32),IN _court INT,IN _date DATE,IN _new_start TIME,IN _new_end TIME)
BEGIN
DECLARE schedule_lock INT;
DECLARE overlap INT;

DECLARE EXIT HANDLER FOR SQLEXCEPTION, SQLWARNING
		BEGIN
			# Release operation lock
			DO RELEASE_LOCK('clubhouse_schedule_lock');
			RESIGNAL;
		END;
        
# Check if start and end are at least 1 min apart
IF TIME_TO_SEC(_new_end) - (TIME_TO_SEC(_new_start) + 60) <= 0 THEN
	SIGNAL SQLSTATE '45000'
	SET MESSAGE_TEXT = 'Start and End must be at least 1 min apart';
END IF;

SELECT GET_LOCK('clubhouse_schedule_lock', 1) INTO schedule_lock;
	   
IF schedule_lock <> 1 THEN
	SIGNAL SQLSTATE '45000'
	SET MESSAGE_TEXT = 'Could not obtain schedule lock';
END IF;

SELECT 
	COUNT(*)
INTO overlap FROM
	activity
WHERE
	_new_end > start 
    AND _new_start < end
	AND court = _court
	AND date = _date
	AND active = 1
    AND id <> _id;
 
IF overlap > 0 THEN
	SIGNAL SQLSTATE '45000'
	SET MESSAGE_TEXT = 'Overlapping session found. Check schedule';
END IF;

UPDATE activity set start = _new_start, end = _new_end WHERE id = _id AND MD5(updated) = _hash; 

# Release operation lock
DO RELEASE_LOCK('clubhouse_schedule_lock');

END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `getBookingsForDate` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `getBookingsForDate`(IN _date DATE)
BEGIN
    
    SELECT
		JSON_OBJECT('id', a.id, 'updated' , a.updated , 'type', a.type, 'date', a.date ,'start', a.start, 'end' , a.end , 'court' , a.court, 'bumpable', bumpable , 'notes', a.notes ,'players', p.players) as 'booking'
	FROM 
		activity a
	LEFT JOIN (
		SELECT activity,cast(concat('[',group_concat(json_object('id',person,'type',player.type,'firstname',p.firstname,'lastname',p.lastname)),']') as JSON) as players 
		FROM player
		join person p on p.id = player.person
		GROUP BY activity ) p 
	ON a.id = p.activity
    WHERE date = _date
    and a.active = 1;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `getmembers` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ALLOW_INVALID_DATES,ERROR_FOR_DIVISION_BY_ZERO,TRADITIONAL,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `getmembers`()
BEGIN
	SELECT * FROM member;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `splitAndMoveActivity` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `splitAndMoveActivity`(IN _id INT, IN _hash VARCHAR(32),IN _date DATE,IN _start TIME, IN _end TIME, IN _bumpable TINYINT, IN _notes VARCHAR(256),IN _split_time TIME,IN _new_court INT, IN _type INT)
BEGIN
	DECLARE schedule_lock INT;
	DECLARE overlap INT;
	DECLARE second_activity_id INT;

	DECLARE EXIT HANDLER FOR SQLEXCEPTION, SQLWARNING
		BEGIN
			# Release operation lock
			DO RELEASE_LOCK('clubhouse_schedule_lock');
			RESIGNAL;
		END;

	UPDATE activity SET `end` = _split_time WHERE id = _id and md5(updated) = _hash;

	SELECT GET_LOCK('clubhouse_schedule_lock', 1) INTO schedule_lock;
	   
	IF schedule_lock <> 1 THEN
		SIGNAL SQLSTATE '45000'
		SET MESSAGE_TEXT = 'Could not obtain schedule lock';
	END IF;
    
    SELECT 
		COUNT(*)
	INTO overlap FROM
		activity
	WHERE
		_end > start 
		AND _split_time < end
		AND court = _new_court
		AND date = _date
		AND active = 1;
	 
	IF overlap > 0 THEN
		SIGNAL SQLSTATE '45000'
		SET MESSAGE_TEXT = 'Overlapping session';
	END IF;
    
    UPDATE activity set end = _split_time WHERE id = _id; 
    
    INSERT INTO `activity` (`id`, `created`, `updated`, `type`, `court`, `date` ,`start`, `end`, `bumpable`,`active`,`notes`) 
    VALUES (NULL, null, NULL, _type, _new_court, _date,_split_time, _end, _bumpable ,1,_notes);
   
    SET second_activity_id = LAST_INSERT_ID();
	
    INSERT INTO `participant` select null,second_activity_id,`person`,`status`,`type` from player where activity = _id;
    
	# Release operation lock
	DO RELEASE_LOCK('clubhouse_schedule_lock');
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

USE `clubhouse`;
/*!50001 DROP VIEW IF EXISTS `activities_view`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `activities_view` AS select `a`.`id` AS `id`,`a`.`start` AS `start`,`a`.`end` AS `end`,json_object('id',`a`.`id`,'updated',`a`.`updated`,'start',`a`.`start`,'end',`a`.`end`,'court',`a`.`court`,'bumpable',`a`.`bumpable`,'notes',`a`.`notes`,'players',`p`.`players`) AS `details` from (`activity` `a` left join (select `participant`.`activity` AS `activity`,cast(concat('[',group_concat(json_object('id',`participant`.`person`,'repeater',`participant`.`type`,'firstname',`p`.`firstname`,'lastname',`p`.`lastname`) separator ','),']') as json) AS `players` from (`participant` join `person` `p` on((`p`.`id` = `participant`.`person`))) group by `participant`.`activity`) `p` on((`a`.`id` = `p`.`activity`))) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `membership_view`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `membership_view` AS select `p`.`id` AS `id`,`p`.`firstname` AS `firstname`,`p`.`lastname` AS `lastname`,`p`.`email` AS `email`,`p`.`club` AS `club`,`m`.`valid_from` AS `valid_from`,`m`.`valid_until` AS `valid_until`,`m`.`role` AS `role`,`r`.`lbl` AS `role_name`,`rt`.`id` AS `role_type_id`,`rt`.`label` AS `role_type_name`,`rt`.`guest_host` AS `guest_host`,`rt`.`event_host` AS `event_host` from (((`membership` `m` join `role` `r` on((`r`.`id` = `m`.`role`))) join `role_type` `rt` on((`rt`.`id` = `r`.`type`))) join `person` `p` on((`p`.`id` = `m`.`person_id`))) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

