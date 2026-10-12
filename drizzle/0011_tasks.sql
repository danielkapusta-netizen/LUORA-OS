CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text DEFAULT 'lime' NOT NULL,
	`owner_id` text,
	`demo` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `projects_archived_idx` ON `projects` (`archived_at`);--> statement-breakpoint
CREATE TABLE `task_assignees` (
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `user_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_assignees_user_idx` ON `task_assignees` (`user_id`);--> statement-breakpoint
CREATE TABLE `task_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text,
	`kind` text DEFAULT 'comment' NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `task_comments_task_idx` ON `task_comments` (`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`project_id` text,
	`due_date` text,
	`start_time` text,
	`end_time` text,
	`tags` text NOT NULL,
	`checklist` text NOT NULL,
	`customer_id` text,
	`order_id` text,
	`created_by` text,
	`done_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_status_due_idx` ON `tasks` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_project_idx` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_customer_idx` ON `tasks` (`customer_id`);--> statement-breakpoint
CREATE INDEX `tasks_order_idx` ON `tasks` (`order_id`);--> statement-breakpoint
-- Tasks that were set on customers become tasks linked to the customer (due dates were stored as 09:00 UTC).
INSERT INTO `tasks` (`id`, `title`, `status`, `priority`, `due_date`, `tags`, `checklist`, `customer_id`, `created_by`, `done_at`, `created_at`, `updated_at`)
SELECT `id`, `title`, CASE WHEN `done_at` IS NULL THEN 'todo' ELSE 'done' END, 'normal',
  CASE WHEN `due_at` IS NULL THEN NULL ELSE strftime('%Y-%m-%d', `due_at` / 1000 + 7200, 'unixepoch') END,
  '[]', '[]', `customer_id`, `created_by`, `done_at`, `created_at`, `created_at`
FROM `customer_tasks`;--> statement-breakpoint
INSERT INTO `task_assignees` (`task_id`, `user_id`) SELECT `id`, `assignee_id` FROM `customer_tasks` WHERE `assignee_id` IS NOT NULL;
