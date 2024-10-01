CREATE TABLE `user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text,
	`email` text,
	`password` text,
	`roles` text DEFAULT '[]' NOT NULL,
	`created_at` text,
	`updated_at` text
);
