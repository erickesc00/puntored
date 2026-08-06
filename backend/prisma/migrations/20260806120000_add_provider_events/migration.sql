-- CreateTable
CREATE TABLE `provider_events` (
    `id` VARCHAR(191) NOT NULL,
    `provider_event_id` VARCHAR(191) NOT NULL,
    `reference_id` VARCHAR(191) NULL,
    `external_reference` VARCHAR(30) NULL,
    `payload_hash` CHAR(64) NOT NULL,
    `event_type` VARCHAR(50) NOT NULL,
    `outcome` VARCHAR(100) NOT NULL,
    `processed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_provider_events_provider_event_id`(`provider_event_id`),
    INDEX `idx_provider_events_reference_processed`(`reference_id`, `processed_at`),
    INDEX `idx_provider_events_processed`(`processed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `provider_events` ADD CONSTRAINT `provider_events_reference_id_fkey` FOREIGN KEY (`reference_id`) REFERENCES `payment_references`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
