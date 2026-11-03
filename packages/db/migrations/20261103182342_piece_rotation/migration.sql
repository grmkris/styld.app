-- D1 keeps foreign keys enabled inside a migration transaction. Adding the
-- constrained column in place preserves every child row that points at a
-- piece (looks, boards, worn history, pictures and turns).
ALTER TABLE `pieces`
  ADD `rotation` integer DEFAULT 0 NOT NULL
  CONSTRAINT "pieces_rotation" CHECK (`rotation` IN (0, 90, 180, 270));
