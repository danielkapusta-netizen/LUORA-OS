ALTER TABLE `product_listings` ADD `price` text;--> statement-breakpoint
ALTER TABLE `product_listings` ADD `currency` text;--> statement-breakpoint
ALTER TABLE `product_listings` ADD `price_updated_at` integer;--> statement-breakpoint
ALTER TABLE `product_listings` ADD `price_error` text;--> statement-breakpoint
ALTER TABLE `product_listings` ADD `price_manual` integer DEFAULT false NOT NULL;