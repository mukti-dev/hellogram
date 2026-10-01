-- Labels become the user's own words + an icon (no presets); numbers get a media-sharing switch.
-- Existing numbers keep their label: olx → "OLX" (shopping bag), dating → "Dating" (heart),
-- tenants → "Tenants" (home), other → its custom text or "Other" (tag).

ALTER TABLE "personas"
  ADD COLUMN "labelName" VARCHAR(20),
  ADD COLUMN "labelIcon" VARCHAR(24) NOT NULL DEFAULT 'tag',
  ADD COLUMN "allowMedia" BOOLEAN NOT NULL DEFAULT true;

UPDATE "personas" SET
  "labelName" = CASE "labelKind"
    WHEN 'olx' THEN 'OLX'
    WHEN 'dating' THEN 'Dating'
    WHEN 'tenants' THEN 'Tenants'
    ELSE COALESCE(NULLIF(LEFT(BTRIM("labelText"), 20), ''), 'Other')
  END,
  "labelIcon" = CASE "labelKind"
    WHEN 'olx' THEN 'shopping-bag'
    WHEN 'dating' THEN 'heart'
    WHEN 'tenants' THEN 'home'
    ELSE 'tag'
  END;

ALTER TABLE "personas" ALTER COLUMN "labelName" SET NOT NULL;
ALTER TABLE "personas" DROP COLUMN "labelKind", DROP COLUMN "labelText";

ALTER TABLE "persona_drafts"
  ADD COLUMN "labelName" VARCHAR(20),
  ADD COLUMN "labelIcon" VARCHAR(24) NOT NULL DEFAULT 'tag',
  ADD COLUMN "allowMedia" BOOLEAN NOT NULL DEFAULT true;

UPDATE "persona_drafts" SET
  "labelName" = CASE "labelKind"
    WHEN 'olx' THEN 'OLX'
    WHEN 'dating' THEN 'Dating'
    WHEN 'tenants' THEN 'Tenants'
    ELSE COALESCE(NULLIF(LEFT(BTRIM("labelText"), 20), ''), 'Other')
  END,
  "labelIcon" = CASE "labelKind"
    WHEN 'olx' THEN 'shopping-bag'
    WHEN 'dating' THEN 'heart'
    WHEN 'tenants' THEN 'home'
    ELSE 'tag'
  END;

ALTER TABLE "persona_drafts" ALTER COLUMN "labelName" SET NOT NULL;
ALTER TABLE "persona_drafts" DROP COLUMN "labelKind", DROP COLUMN "labelText";

DROP TYPE "LabelKind";
