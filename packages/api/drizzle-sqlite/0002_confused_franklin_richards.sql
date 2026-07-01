CREATE TABLE `run_flow_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`source_node_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`ready_delay_ms` integer DEFAULT 1000 NOT NULL,
	FOREIGN KEY (`flow_id`) REFERENCES `run_flows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_node_id`) REFERENCES `run_flow_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_node_id`) REFERENCES `run_flow_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `run_flow_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`run_config_id` text NOT NULL,
	`x` integer DEFAULT 0 NOT NULL,
	`y` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`flow_id`) REFERENCES `run_flows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_config_id`) REFERENCES `run_configs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `run_flows` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`viewport` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
