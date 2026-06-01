ALTER TABLE `events` ADD `description` text;--> statement-breakpoint
ALTER TABLE `events` ADD `event_date` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `cap` integer DEFAULT 10737418240 NOT NULL;