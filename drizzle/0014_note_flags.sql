ALTER TABLE `order_events` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `order_events` ADD `edited_at` integer;--> statement-breakpoint
ALTER TABLE `order_events` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `order_events` ADD `task_id` text REFERENCES tasks(id) ON DELETE SET NULL;