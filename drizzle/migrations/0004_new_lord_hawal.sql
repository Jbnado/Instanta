ALTER TABLE `sessions` ADD `mfa_verified_at` integer;--> statement-breakpoint
ALTER TABLE `user_mfa_secrets` ADD `confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `user_mfa_secrets` ADD `recovery_codes_hash` text;--> statement-breakpoint
ALTER TABLE `user_mfa_secrets` ADD `last_verified_code` text;--> statement-breakpoint
ALTER TABLE `user_mfa_secrets` ADD `last_verified_at` integer;