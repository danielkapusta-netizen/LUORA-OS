CREATE TABLE `analytics_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`currency` text NOT NULL,
	`day` text NOT NULL,
	`rate` real NOT NULL,
	PRIMARY KEY(`currency`, `day`)
);
--> statement-breakpoint
CREATE TABLE `order_fees` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`order_item_id` text,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`label` text,
	`amount` text NOT NULL,
	`tax_amount` text,
	`currency` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_fees_source_external_idx` ON `order_fees` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `order_fees_order_idx` ON `order_fees` (`order_id`);--> statement-breakpoint
CREATE TABLE `order_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`order_item_id` text,
	`external_id` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`quantity` integer,
	`restocked` integer DEFAULT false NOT NULL,
	`refunded_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_refunds_order_external_idx` ON `order_refunds` (`order_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `order_refunds_refunded_idx` ON `order_refunds` (`refunded_at`);--> statement-breakpoint
CREATE TABLE `product_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`unit_cost` text NOT NULL,
	`purchase_price` text,
	`purchase_currency` text,
	`freight` text,
	`duty` text,
	`effective_from` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_costs_product_from_idx` ON `product_costs` (`product_id`,`effective_from`);--> statement-breakpoint
ALTER TABLE `marketplace_accounts` ADD `history_cursor` text;--> statement-breakpoint
ALTER TABLE `marketplace_accounts` ADD `history_state` text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE `marketplace_accounts` ADD `history_imported` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `marketplace_accounts` ADD `history_error` text;--> statement-breakpoint
ALTER TABLE `marketplace_accounts` ADD `history_updated_at` integer;--> statement-breakpoint
ALTER TABLE `marketplace_accounts` ADD `fees_cursor` text;--> statement-breakpoint
ALTER TABLE `marketplace_accounts` ADD `fees_synced_at` integer;--> statement-breakpoint
ALTER TABLE `marketplace_accounts` ADD `fees_error` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `discount_amount` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `discount_amount` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `historical` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `brand` text;--> statement-breakpoint
ALTER TABLE `products` ADD `category` text;