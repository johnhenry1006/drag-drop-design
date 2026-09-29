ALTER TABLE pages ADD COLUMN parent_page_id uuid;
ALTER TABLE pages ADD COLUMN slug text;
ALTER TABLE pages ADD COLUMN sort_order integer;

DO $$
DECLARE item record; base_slug text; candidate text; suffix integer;
BEGIN
  FOR item IN SELECT id, project_id, path FROM pages ORDER BY project_id, created_at, id LOOP
    base_slug := CASE WHEN item.path='/' THEN 'home' ELSE regexp_replace(item.path, '^.*/', '') END;
    base_slug := trim(both '-' from regexp_replace(base_slug, '-+', '-', 'g'));
    IF base_slug='' THEN base_slug := 'page'; END IF;
    candidate := base_slug;
    suffix := 2;
    WHILE EXISTS (SELECT 1 FROM pages WHERE project_id=item.project_id AND parent_page_id IS NULL AND slug=candidate) LOOP
      candidate := base_slug || '-' || suffix;
      suffix := suffix + 1;
    END LOOP;
    UPDATE pages SET slug=candidate WHERE id=item.id;
  END LOOP;
END $$;

WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at, id)-1 AS ordinal FROM pages
) UPDATE pages SET sort_order=ordered.ordinal FROM ordered WHERE pages.id=ordered.id;

ALTER TABLE pages ALTER COLUMN slug SET NOT NULL;
ALTER TABLE pages ALTER COLUMN sort_order SET NOT NULL;
ALTER TABLE pages ADD CONSTRAINT pages_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
ALTER TABLE pages ADD CONSTRAINT pages_project_id_id_unique UNIQUE(project_id,id);
ALTER TABLE pages ADD CONSTRAINT pages_parent_same_project FOREIGN KEY(project_id,parent_page_id) REFERENCES pages(project_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX pages_root_slug_unique ON pages(project_id,slug) WHERE parent_page_id IS NULL;
CREATE UNIQUE INDEX pages_child_slug_unique ON pages(project_id,parent_page_id,slug) WHERE parent_page_id IS NOT NULL;
CREATE UNIQUE INDEX pages_root_order_unique ON pages(project_id,sort_order) WHERE parent_page_id IS NULL;
CREATE UNIQUE INDEX pages_child_order_unique ON pages(project_id,parent_page_id,sort_order) WHERE parent_page_id IS NOT NULL;
CREATE INDEX pages_parent_idx ON pages(project_id,parent_page_id,sort_order,id);
