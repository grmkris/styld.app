-- Drawings left in a state from before 4 November 2026, when the check against the cut-out was dropped, moved to what
-- the picture job made of them since (`capture/Drawing.ts` › `showStored` before this change): one stored and still
-- `checking` is shown (`ready`), or `failed` when it holds no drawing; one `rejected` by the check ended with its photo
-- shown, which is `failed` now (the owner's view already showed it as failed, and the backfill redrew both alike).
-- Plain UPDATEs: the state CHECK keeps both values, so no table is rebuilt and no row that references one is touched.
UPDATE `piece_pictures`
SET `state` = CASE WHEN `clean_key` IS NULL THEN 'failed' ELSE 'ready' END
WHERE `state` = 'checking';
--> statement-breakpoint
UPDATE `piece_pictures` SET `state` = 'failed' WHERE `state` = 'rejected';
--> statement-breakpoint
UPDATE `piece_back_pictures`
SET `state` = CASE WHEN `clean_key` IS NULL THEN 'failed' ELSE 'ready' END
WHERE `state` = 'checking';
--> statement-breakpoint
UPDATE `piece_back_pictures` SET `state` = 'failed' WHERE `state` = 'rejected';
