CREATE TABLE `pricing_recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`account_id` text NOT NULL,
	`listing_id` text,
	`status` text NOT NULL,
	`recommended_price` text,
	`observed_luora_price` text,
	`rationale` text NOT NULL,
	`sources` text NOT NULL,
	`researched_at` integer NOT NULL,
	`run_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `marketplace_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`listing_id`) REFERENCES `product_listings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_recommendations_product_account_idx` ON `pricing_recommendations` (`product_id`,`account_id`);
