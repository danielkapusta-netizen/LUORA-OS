ALTER TABLE `product_listings` ADD `active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `product_listings` ADD `listing_status` text;--> statement-breakpoint
ALTER TABLE `product_listings` ADD `stock_mode` text DEFAULT 'master' NOT NULL;--> statement-breakpoint
ALTER TABLE `product_listings` ADD `fixed_qty` integer;