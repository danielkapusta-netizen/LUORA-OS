CREATE TABLE `stock_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`user_id` text,
	`accounts` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `stock_sync_runs_started_idx` ON `stock_sync_runs` (`started_at`);--> statement-breakpoint
ALTER TABLE `product_listings` ADD `sold_out` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `product_listings` ADD `stock_locked` text;--> statement-breakpoint
-- Shopify never received stock until now, and its numbers are the right ones. Start it in dry run ("review"), so the
-- first push after this release cannot overwrite the shop: take Shopify's numbers on the Inventory page, then switch sending on.
UPDATE `marketplace_accounts` SET `stock_dry_run` = 1 WHERE `type` = 'shopify';
--> statement-breakpoint
-- The refusals recorded on Shopify listings came from the push that never got through; they say nothing about the next one.
UPDATE `product_listings` SET `last_push_error` = NULL WHERE `account_id` IN (SELECT `id` FROM `marketplace_accounts` WHERE `type` = 'shopify');
