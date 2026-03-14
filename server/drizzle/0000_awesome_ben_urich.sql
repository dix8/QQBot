CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`detail` text,
	`username` text,
	`ip` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_action_created_idx` ON `audit_logs` (`action`,`created_at`);--> statement-breakpoint
CREATE TABLE `bot_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`self_id` integer,
	`ws_host` text DEFAULT '0.0.0.0' NOT NULL,
	`ws_port` integer DEFAULT 8095 NOT NULL,
	`ws_token` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`remark` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`avatar_url` text DEFAULT '' NOT NULL,
	`sent_message_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`level` text NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`details` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `logs_level_created_idx` ON `logs` (`level`,`created_at`);--> statement-breakpoint
CREATE INDEX `logs_source_created_idx` ON `logs` (`source`,`created_at`);--> statement-breakpoint
CREATE TABLE `message_rankings` (
	`type` text NOT NULL,
	`target_id` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`type`, `target_id`)
);
--> statement-breakpoint
CREATE TABLE `message_stats` (
	`hour` text PRIMARY KEY NOT NULL,
	`received` integer DEFAULT 0 NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_id` integer,
	`message_id` integer,
	`message_type` text NOT NULL,
	`group_id` integer,
	`user_id` integer NOT NULL,
	`nickname` text,
	`raw_message` text,
	`time` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_bot_idx` ON `messages` (`bot_id`);--> statement-breakpoint
CREATE INDEX `messages_type_group_idx` ON `messages` (`message_type`,`group_id`);--> statement-breakpoint
CREATE INDEX `messages_time_idx` ON `messages` (`time`);--> statement-breakpoint
CREATE TABLE `plugin_config` (
	`plugin_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`plugin_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`description` text,
	`author` text,
	`repo` text,
	`entry_file` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`config_schema` text DEFAULT '[]' NOT NULL,
	`commands` text DEFAULT '[]' NOT NULL,
	`installed_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugins_name_unique` ON `plugins` (`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`is_default_pwd` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);