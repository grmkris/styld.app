-- The rotation a piece's drawing was drawn at: Muse draws from the cut-out turned by the piece's rotation (since
-- 4cb61c56), and the drawing is shown turned by what the rotation is past it. Added in place, so no child row of
-- `piece_pictures` or `pieces` is touched.
ALTER TABLE `piece_pictures`
  ADD `drawn_rotation` integer DEFAULT 0 NOT NULL
  CONSTRAINT "piece_pictures_drawn_rotation" CHECK (`drawn_rotation` IN (0, 90, 180, 270));
--> statement-breakpoint
-- A drawing finished after the turned cut-out reached the preview (13:35 UTC, 4 November 2026), on a piece last
-- changed before it, was drawn at the piece's rotation; every other was drawn at 0. Read on 4 November: one such
-- drawing on the preview and one in production.
UPDATE `piece_pictures`
SET `drawn_rotation` = (SELECT `rotation` FROM `pieces` WHERE `pieces`.`id` = `piece_pictures`.`piece_id`)
WHERE `updated_at` > 1793799330000
  AND `clean_key` IS NOT NULL
  AND `updated_at` > (SELECT `updated_at` FROM `pieces` WHERE `pieces`.`id` = `piece_pictures`.`piece_id`);
