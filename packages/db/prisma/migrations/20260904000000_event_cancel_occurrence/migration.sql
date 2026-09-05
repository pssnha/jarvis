-- Cancelled single occurrence: a tombstone override row (rrule null, with
-- recurrenceParentId/recurrenceStart set) marks one instance of a recurring
-- series as skipped. It must not fire a reminder or show on any calendar, so
-- every "live events" query filters `cancelled = false`. The parent's expansion
-- already skips the instant because an override row exists at that recurrenceStart.
ALTER TABLE `Event` ADD COLUMN `cancelled` BOOLEAN NOT NULL DEFAULT false;
