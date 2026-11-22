CREATE TABLE `channel_blueprint` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
