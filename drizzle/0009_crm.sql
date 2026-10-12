CREATE TABLE `crm_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customer_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_identities_kind_value_idx` ON `customer_identities` (`kind`,`value`);--> statement-breakpoint
CREATE INDEX `customer_identities_customer_idx` ON `customer_identities` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customer_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`body` text NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `customer_notes_customer_idx` ON `customer_notes` (`customer_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `customer_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`title` text NOT NULL,
	`due_at` integer,
	`assignee_id` text,
	`done_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `customer_tasks_open_idx` ON `customer_tasks` (`done_at`,`due_at`);--> statement-breakpoint
CREATE INDEX `customer_tasks_customer_idx` ON `customer_tasks` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`phone` text,
	`city` text,
	`country_code` text,
	`first_order_at` integer,
	`last_order_at` integer,
	`orders_count` integer DEFAULT 0 NOT NULL,
	`revenue` real DEFAULT 0 NOT NULL,
	`profit` real DEFAULT 0 NOT NULL,
	`marketplaces` text NOT NULL,
	`tags` text NOT NULL,
	`marketing_consent` integer,
	`shopify_customer_id` text,
	`synced_tags` text,
	`synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customers_last_order_idx` ON `customers` (`last_order_at`);--> statement-breakpoint
CREATE INDEX `customers_email_idx` ON `customers` (`email`);--> statement-breakpoint
ALTER TABLE `orders` ADD `customer_id` text;--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`);