-- Six categories with sleeve-length shelves become shop-style garment types (owner, 2026-10-31). Existing rows map to
-- the nearest type here; the schedule's sweep then asks the decision model once for every piece (pieces.suggested_at).
ALTER TABLE `detections` ADD `suggested_type` text;--> statement-breakpoint
ALTER TABLE `detections` ADD `suggested_season` text;--> statement-breakpoint
ALTER TABLE `detections` ADD `suggested_occasions` text NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `detections` ADD `suggested_pattern` text;--> statement-breakpoint
ALTER TABLE `pieces` ADD `type` text NOT NULL DEFAULT 'tops';--> statement-breakpoint
ALTER TABLE `pieces` ADD `season` text;--> statement-breakpoint
ALTER TABLE `pieces` ADD `occasions` text NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `pieces` ADD `pattern` text;--> statement-breakpoint
ALTER TABLE `pieces` ADD `brand` text;--> statement-breakpoint
ALTER TABLE `pieces` ADD `shop_url` text;--> statement-breakpoint
ALTER TABLE `pieces` ADD `suggested_at` integer;--> statement-breakpoint
UPDATE `pieces` SET `type` = CASE
  WHEN `category` = 'top' AND `subcategory` = 'sport' THEN 'sportswear'
  WHEN `category` = 'bottom' AND `subcategory` = 'jeans' THEN 'jeans'
  WHEN `category` = 'bottom' AND `subcategory` = 'trousers' THEN 'trousers'
  WHEN `category` = 'bottom' AND `subcategory` = 'leggings' THEN 'trousers'
  WHEN `category` = 'bottom' AND `subcategory` = 'shorts' THEN 'shorts'
  WHEN `category` = 'bottom' AND `subcategory` = 'skirts' THEN 'skirts'
  WHEN `category` = 'bottom' AND `subcategory` = 'loungewear' THEN 'loungewear'
  WHEN `category` = 'bottom' AND `subcategory` = 'sport' THEN 'sportswear'
  WHEN `category` = 'dress' AND `subcategory` = 'jumpsuit' THEN 'jumpsuits'
  WHEN `category` = 'dress' AND `subcategory` = 'sport' THEN 'sportswear'
  WHEN `category` = 'outerwear' AND `subcategory` = 'coats' THEN 'coats'
  WHEN `category` = 'outerwear' AND `subcategory` = 'jackets' THEN 'jackets'
  WHEN `category` = 'outerwear' AND `subcategory` = 'blazers' THEN 'blazers'
  WHEN `category` = 'outerwear' AND `subcategory` = 'vests' THEN 'gilets'
  WHEN `category` = 'shoes' AND `subcategory` = 'boots' THEN 'boots'
  WHEN `category` = 'shoes' AND `subcategory` = 'heels' THEN 'heels'
  WHEN `category` = 'shoes' AND `subcategory` = 'sandals' THEN 'sandals'
  WHEN `category` = 'shoes' AND `subcategory` = 'flats' THEN 'flats'
  WHEN `category` = 'accessory' AND `subcategory` = 'glasses' THEN 'eyewear'
  WHEN `category` = 'accessory' AND `subcategory` = 'belts' THEN 'belts'
  WHEN `category` = 'accessory' AND `subcategory` = 'bags' THEN 'bags'
  WHEN `category` = 'accessory' AND `subcategory` = 'scarves' THEN 'scarves'
  WHEN `category` = 'accessory' AND `subcategory` = 'hats' THEN 'hats'
  WHEN `category` = 'accessory' AND `subcategory` = 'jewelry' THEN 'jewellery'
  WHEN `category` = 'top' THEN 'tops'
  WHEN `category` = 'bottom' THEN 'trousers'
  WHEN `category` = 'dress' THEN 'dresses'
  WHEN `category` = 'outerwear' THEN 'jackets'
  WHEN `category` = 'shoes' THEN 'trainers'
  WHEN `category` = 'accessory' THEN 'bags'
  ELSE 'tops'
END;--> statement-breakpoint
UPDATE `detections` SET `suggested_type` = CASE
  WHEN `suggested_category` = 'top' AND `suggested_subcategory` = 'sport' THEN 'sportswear'
  WHEN `suggested_category` = 'bottom' AND `suggested_subcategory` = 'jeans' THEN 'jeans'
  WHEN `suggested_category` = 'bottom' AND `suggested_subcategory` = 'trousers' THEN 'trousers'
  WHEN `suggested_category` = 'bottom' AND `suggested_subcategory` = 'leggings' THEN 'trousers'
  WHEN `suggested_category` = 'bottom' AND `suggested_subcategory` = 'shorts' THEN 'shorts'
  WHEN `suggested_category` = 'bottom' AND `suggested_subcategory` = 'skirts' THEN 'skirts'
  WHEN `suggested_category` = 'bottom' AND `suggested_subcategory` = 'loungewear' THEN 'loungewear'
  WHEN `suggested_category` = 'bottom' AND `suggested_subcategory` = 'sport' THEN 'sportswear'
  WHEN `suggested_category` = 'dress' AND `suggested_subcategory` = 'jumpsuit' THEN 'jumpsuits'
  WHEN `suggested_category` = 'dress' AND `suggested_subcategory` = 'sport' THEN 'sportswear'
  WHEN `suggested_category` = 'outerwear' AND `suggested_subcategory` = 'coats' THEN 'coats'
  WHEN `suggested_category` = 'outerwear' AND `suggested_subcategory` = 'jackets' THEN 'jackets'
  WHEN `suggested_category` = 'outerwear' AND `suggested_subcategory` = 'blazers' THEN 'blazers'
  WHEN `suggested_category` = 'outerwear' AND `suggested_subcategory` = 'vests' THEN 'gilets'
  WHEN `suggested_category` = 'shoes' AND `suggested_subcategory` = 'boots' THEN 'boots'
  WHEN `suggested_category` = 'shoes' AND `suggested_subcategory` = 'heels' THEN 'heels'
  WHEN `suggested_category` = 'shoes' AND `suggested_subcategory` = 'sandals' THEN 'sandals'
  WHEN `suggested_category` = 'shoes' AND `suggested_subcategory` = 'flats' THEN 'flats'
  WHEN `suggested_category` = 'accessory' AND `suggested_subcategory` = 'glasses' THEN 'eyewear'
  WHEN `suggested_category` = 'accessory' AND `suggested_subcategory` = 'belts' THEN 'belts'
  WHEN `suggested_category` = 'accessory' AND `suggested_subcategory` = 'bags' THEN 'bags'
  WHEN `suggested_category` = 'accessory' AND `suggested_subcategory` = 'scarves' THEN 'scarves'
  WHEN `suggested_category` = 'accessory' AND `suggested_subcategory` = 'hats' THEN 'hats'
  WHEN `suggested_category` = 'accessory' AND `suggested_subcategory` = 'jewelry' THEN 'jewellery'
  WHEN `suggested_category` = 'top' THEN 'tops'
  WHEN `suggested_category` = 'bottom' THEN 'trousers'
  WHEN `suggested_category` = 'dress' THEN 'dresses'
  WHEN `suggested_category` = 'outerwear' THEN 'jackets'
  WHEN `suggested_category` = 'shoes' THEN 'trainers'
  WHEN `suggested_category` = 'accessory' THEN 'bags'
  ELSE 'tops'
END WHERE `suggested_category` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `detections` DROP COLUMN `suggested_category`;--> statement-breakpoint
ALTER TABLE `detections` DROP COLUMN `suggested_subcategory`;--> statement-breakpoint
ALTER TABLE `pieces` DROP COLUMN `category`;--> statement-breakpoint
ALTER TABLE `pieces` DROP COLUMN `subcategory`;
