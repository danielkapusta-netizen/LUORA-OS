CREATE TABLE `sales_lines` (
	`item_id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`account_id` text NOT NULL,
	`marketplace` text NOT NULL,
	`product_id` text,
	`customer_id` text,
	`placed_at` integer NOT NULL,
	`day` text NOT NULL,
	`currency` text NOT NULL,
	`fx_rate` real NOT NULL,
	`vat_rate` real NOT NULL,
	`quantity` integer NOT NULL,
	`refunded_quantity` integer DEFAULT 0 NOT NULL,
	`gross` real NOT NULL,
	`net` real NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`fees` real NOT NULL,
	`fees_estimated` integer NOT NULL,
	`cost` real NOT NULL,
	`cost_known` integer NOT NULL,
	`shipping` real NOT NULL,
	`delivery` real NOT NULL,
	`refunds` real NOT NULL,
	`profit` real NOT NULL,
	`computed_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sales_lines_day_idx` ON `sales_lines` (`day`);--> statement-breakpoint
CREATE INDEX `sales_lines_order_idx` ON `sales_lines` (`order_id`);--> statement-breakpoint
CREATE INDEX `sales_lines_product_idx` ON `sales_lines` (`product_id`,`day`);--> statement-breakpoint
CREATE INDEX `sales_lines_customer_idx` ON `sales_lines` (`customer_id`);