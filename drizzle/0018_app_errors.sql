CREATE TABLE `app_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`digest` text,
	`path` text,
	`route` text,
	`kind` text,
	`message` text,
	`stack` text
);
--> statement-breakpoint
CREATE INDEX `app_errors_digest_idx` ON `app_errors` (`digest`);--> statement-breakpoint
CREATE INDEX `app_errors_at_idx` ON `app_errors` (`created_at`);