CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`industry` text,
	`website` text,
	`phone` text,
	`email` text,
	`address` text,
	`city` text,
	`state` text,
	`zip` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `crm_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `companies_org_client_name_idx` ON `companies` (`organization_id`,`client_id`,`name`);--> statement-breakpoint
CREATE INDEX `companies_email_idx` ON `companies` (`email`);--> statement-breakpoint
CREATE TABLE `contact_company_links` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`company_id` text NOT NULL,
	`relationship` text DEFAULT 'employee' NOT NULL,
	`is_primary` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `crm_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_company_links_contact_company_uidx` ON `contact_company_links` (`contact_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `contact_company_links_company_idx` ON `contact_company_links` (`company_id`);--> statement-breakpoint
CREATE TABLE `custom_field_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`field_key` text NOT NULL,
	`label` text NOT NULL,
	`field_type` text NOT NULL,
	`options_json` text DEFAULT '[]' NOT NULL,
	`is_required` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `crm_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_field_definitions_client_entity_key_uidx` ON `custom_field_definitions` (`client_id`,`entity_type`,`field_key`);--> statement-breakpoint
CREATE INDEX `custom_field_definitions_scope_idx` ON `custom_field_definitions` (`organization_id`,`client_id`,`entity_type`,`position`);--> statement-breakpoint
CREATE TABLE `custom_field_values` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`definition_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`value_json` text DEFAULT 'null' NOT NULL,
	`updated_by_email` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `crm_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`definition_id`) REFERENCES `custom_field_definitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_field_values_definition_entity_uidx` ON `custom_field_values` (`definition_id`,`entity_id`);--> statement-breakpoint
CREATE INDEX `custom_field_values_entity_idx` ON `custom_field_values` (`organization_id`,`client_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `custom_values` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`value_key` text NOT NULL,
	`label` text NOT NULL,
	`value` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `crm_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_values_client_key_uidx` ON `custom_values` (`client_id`,`value_key`);--> statement-breakpoint
CREATE INDEX `custom_values_scope_idx` ON `custom_values` (`organization_id`,`client_id`);--> statement-breakpoint
CREATE TABLE `domain_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text,
	`event_type` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`processing_status` text DEFAULT 'pending' NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`processed_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `crm_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `domain_events_pending_idx` ON `domain_events` (`processing_status`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `domain_events_org_type_idx` ON `domain_events` (`organization_id`,`event_type`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text,
	`module_key` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`rollout_status` text DEFAULT 'disabled' NOT NULL,
	`source` text DEFAULT 'platform' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `crm_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_flags_scope_module_uidx` ON `feature_flags` (`organization_id`,`client_id`,`module_key`);--> statement-breakpoint
CREATE INDEX `feature_flags_org_module_idx` ON `feature_flags` (`organization_id`,`module_key`);