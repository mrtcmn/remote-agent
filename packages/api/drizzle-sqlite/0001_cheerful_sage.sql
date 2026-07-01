CREATE TABLE `machines` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`last_seen_at` integer,
	`session_count` integer DEFAULT 0 NOT NULL,
	`version` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `paired_masters` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`url` text NOT NULL,
	`name` text NOT NULL,
	`machine_token` text NOT NULL,
	`last_sync_at` integer,
	`last_sync_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pairing_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `machines_token_hash_unique` ON `machines` (`token_hash`);