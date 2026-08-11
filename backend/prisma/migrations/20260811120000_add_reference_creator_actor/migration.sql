-- AlterTable
ALTER TABLE `payment_references`
    ADD COLUMN `creator_actor_type` ENUM('USER', 'PROVIDER') NULL,
    ADD COLUMN `creator_actor_id` VARCHAR(191) NULL;

-- Backfill existing internal references
UPDATE `payment_references`
SET
    `creator_actor_type` = 'USER',
    `creator_actor_id` = `created_by`
WHERE `creator_actor_type` IS NULL;

-- Enforce not-null creator actor columns
ALTER TABLE `payment_references`
    MODIFY `creator_actor_type` ENUM('USER', 'PROVIDER') NOT NULL,
    MODIFY `creator_actor_id` VARCHAR(191) NOT NULL,
    MODIFY `created_by` VARCHAR(191) NULL;
