-- The type the decision model was torn with, offered beside its first choice in the review (5 November). Added in
-- place, with no CHECK, so no row of `detections` is rebuilt.
ALTER TABLE `detections` ADD `suggested_alternative` text;