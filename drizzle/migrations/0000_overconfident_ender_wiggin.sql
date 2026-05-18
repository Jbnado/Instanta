CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`actor_user_id` text,
	`target_id` text,
	`ip` text,
	`user_agent` text,
	`payload_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_event_type` ON `audit_log` (`event_type`);--> statement-breakpoint
CREATE INDEX `idx_audit_log_created_at` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `event_bans` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`banned_by_user_id` text NOT NULL,
	`reverted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`banned_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_event_bans_event_id` ON `event_bans` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_event_bans_user_id` ON `event_bans` (`user_id`);--> statement-breakpoint
CREATE TABLE `event_missions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`label` text NOT NULL,
	`is_preset` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_event_missions_event_id` ON `event_missions` (`event_id`);--> statement-breakpoint
CREATE TABLE `event_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`uploader_user_id` text NOT NULL,
	`cf_image_id` text NOT NULL,
	`telao_visible` integer DEFAULT true NOT NULL,
	`hidden_at` integer,
	`hidden_by` text,
	`reports_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploader_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hidden_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_event_photos_event_id` ON `event_photos` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_event_photos_uploader_user_id` ON `event_photos` (`uploader_user_id`);--> statement-breakpoint
CREATE INDEX `idx_event_photos_created_at` ON `event_photos` (`created_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`color_accent` text NOT NULL,
	`status` text NOT NULL,
	`host_user_id` text NOT NULL,
	`bytes_used` integer DEFAULT 0 NOT NULL,
	`scheduled_visibility` integer,
	`ended_at` integer,
	`photos_purged_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`host_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_events_slug` ON `events` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_events_host_user_id` ON `events` (`host_user_id`);--> statement-breakpoint
CREATE INDEX `idx_events_status` ON `events` (`status`);--> statement-breakpoint
CREATE TABLE `lead_captures` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`source_event_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_lead_captures_source_event_id` ON `lead_captures` (`source_event_id`);--> statement-breakpoint
CREATE TABLE `reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`photo_id`) REFERENCES `event_photos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reactions_photo_id` ON `reactions` (`photo_id`);--> statement-breakpoint
CREATE INDEX `idx_reactions_user_id` ON `reactions` (`user_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_id` text NOT NULL,
	`reporter_user_id` text NOT NULL,
	`ip_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`photo_id`) REFERENCES `event_photos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reports_photo_id` ON `reports` (`photo_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_event_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_name_snapshot` text NOT NULL,
	`event_date_snapshot` integer NOT NULL,
	`host_user_id` text,
	`photos_uploaded` integer DEFAULT 0 NOT NULL,
	`reactions_received` integer DEFAULT 0 NOT NULL,
	`missions_completed` integer DEFAULT 0 NOT NULL,
	`instantes_earned` integer DEFAULT 0 NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`host_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_user_event_history_user_id` ON `user_event_history` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_user_event_history_event_id` ON `user_event_history` (`event_id`);--> statement-breakpoint
CREATE TABLE `user_mfa_secrets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`secret_encrypted` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text,
	`total_instantes` integer DEFAULT 0 NOT NULL,
	`current_level` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);