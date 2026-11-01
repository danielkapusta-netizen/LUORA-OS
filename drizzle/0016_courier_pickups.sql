CREATE TABLE `courier_pickups` (
	`id` text PRIMARY KEY NOT NULL,
	`carrier_account_id` text NOT NULL,
	`courier` text NOT NULL,
	`address_label` text NOT NULL,
	`address` text NOT NULL,
	`pickup_date` text NOT NULL,
	`min_time` text,
	`max_time` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`command_id` text,
	`external_id` text,
	`carrier_pickup_id` text,
	`error` text,
	`poll_attempts` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`carrier_account_id`) REFERENCES `carrier_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `courier_pickups_date_idx` ON `courier_pickups` (`pickup_date`);--> statement-breakpoint
CREATE TABLE `pickup_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`name` text,
	`company` text,
	`street` text NOT NULL,
	`postal_code` text NOT NULL,
	`city` text NOT NULL,
	`country_code` text DEFAULT 'PL' NOT NULL,
	`phone` text NOT NULL,
	`email` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `shipments` ADD `pickup_id` text REFERENCES courier_pickups(id);--> statement-breakpoint
CREATE INDEX `shipments_pickup_idx` ON `shipments` (`pickup_id`);