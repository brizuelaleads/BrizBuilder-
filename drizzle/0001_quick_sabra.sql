CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`contact_name` text NOT NULL,
	`service` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `leads_client_id_idx` ON `leads` (`client_id`);