-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(100) NOT NULL,
    `email` VARCHAR(191) NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('OPERATOR', 'SUPERVISOR') NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_users_username`(`username`),
    UNIQUE INDEX `uq_users_email`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `absolute_expires_at` DATETIME(3) NOT NULL,

    INDEX `idx_sessions_user_expires`(`user_id`, `expires_at`),
    INDEX `idx_sessions_expires`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_references` (
    `id` VARCHAR(191) NOT NULL,
    `external_reference` VARCHAR(30) NULL,
    `concept` VARCHAR(255) NOT NULL,
    `amount` BIGINT NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `due_at` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'PAID', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_payment_references_external_reference`(`external_reference`),
    INDEX `idx_payment_references_status_created_id`(`status`, `created_at`, `id`),
    INDEX `idx_payment_references_due_status`(`due_at`, `status`),
    INDEX `idx_payment_references_created_id`(`created_at`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_keys` (
    `id` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(64) NOT NULL,
    `actor_id` VARCHAR(191) NOT NULL,
    `idempotency_key` VARCHAR(191) NOT NULL,
    `request_hash` CHAR(64) NOT NULL,
    `reference_id` VARCHAR(191) NULL,
    `response_code` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `idx_idempotency_keys_expires`(`expires_at`),
    UNIQUE INDEX `uq_idempotency_scope_actor_key`(`scope`, `actor_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_events` (
    `id` VARCHAR(191) NOT NULL,
    `reference_id` VARCHAR(191) NULL,
    `actor_type` ENUM('USER', 'SYSTEM', 'PROVIDER') NOT NULL,
    `actor_id` VARCHAR(191) NULL,
    `action` VARCHAR(100) NOT NULL,
    `result` VARCHAR(100) NOT NULL,
    `correlation_id` VARCHAR(191) NULL,
    `metadata_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_audit_events_reference_created`(`reference_id`, `created_at`),
    INDEX `idx_audit_events_created_id`(`created_at`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_references` ADD CONSTRAINT `payment_references_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `idempotency_keys` ADD CONSTRAINT `idempotency_keys_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `idempotency_keys` ADD CONSTRAINT `idempotency_keys_reference_id_fkey` FOREIGN KEY (`reference_id`) REFERENCES `payment_references`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_reference_id_fkey` FOREIGN KEY (`reference_id`) REFERENCES `payment_references`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
