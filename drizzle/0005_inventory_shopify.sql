ALTER TABLE `product_listings` ADD `ean` text;--> statement-breakpoint
ALTER TABLE `products` ADD `shopify_variant_id` text;--> statement-breakpoint
ALTER TABLE `products` ADD `ean` text;--> statement-breakpoint
CREATE UNIQUE INDEX `products_shopify_variant_id_unique` ON `products` (`shopify_variant_id`);