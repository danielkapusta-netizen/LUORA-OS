CREATE TABLE `accounting_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`credentials` text,
	`settings` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`external_id` text,
	`number` text,
	`gross_amount` text NOT NULL,
	`currency` text NOT NULL,
	`r2_key` text,
	`error` text,
	`uploaded_at` integer,
	`upload_error` text,
	`ksef_sent_at` integer,
	`ksef_status` text,
	`ksef_error` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `invoices_order_idx` ON `invoices` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_one_live_per_order` ON `invoices` (`order_id`) WHERE state in ('pending', 'issued');--> statement-breakpoint
ALTER TABLE `orders` ADD `invoice_request` text;