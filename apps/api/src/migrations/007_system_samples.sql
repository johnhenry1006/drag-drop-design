ALTER TABLE projects ADD COLUMN system_key text;
ALTER TABLE projects ADD CONSTRAINT projects_system_key_unique UNIQUE(system_key);
ALTER TABLE projects ADD CONSTRAINT projects_system_owner CHECK (system_key IS NULL OR owner_id IS NULL);
ALTER TABLE pages ADD COLUMN sample_key text;
ALTER TABLE pages ADD COLUMN fixture_version integer;
ALTER TABLE pages ADD CONSTRAINT pages_sample_key_unique UNIQUE(sample_key);
ALTER TABLE pages ADD CONSTRAINT pages_sample_version CHECK ((sample_key IS NULL AND fixture_version IS NULL) OR (sample_key IS NOT NULL AND fixture_version > 0));

UPDATE projects SET system_key='reference-templates'
WHERE id='00000000-0000-4000-8000-000000000001'::uuid
  AND owner_id IS NULL
  AND EXISTS (SELECT 1 FROM pages WHERE id='00000000-0000-4000-8000-000000000002'::uuid AND project_id=projects.id);
UPDATE pages SET sample_key='northstar-studio',fixture_version=1
WHERE id='00000000-0000-4000-8000-000000000002'::uuid
  AND project_id='00000000-0000-4000-8000-000000000001'::uuid
  AND EXISTS (SELECT 1 FROM projects WHERE id=pages.project_id AND system_key='reference-templates');

CREATE FUNCTION guard_system_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('builder.sample_maintenance', true)='on' THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.system_key IS NOT NULL THEN RAISE EXCEPTION 'System template project metadata is server controlled' USING ERRCODE='23514'; END IF;
  ELSIF TG_OP='UPDATE' THEN
    IF OLD.system_key IS NOT NULL OR NEW.system_key IS DISTINCT FROM OLD.system_key THEN RAISE EXCEPTION 'System template project cannot be changed' USING ERRCODE='23514'; END IF;
  ELSIF OLD.system_key IS NOT NULL THEN
    RAISE EXCEPTION 'System template project cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_system_project_trigger BEFORE INSERT OR UPDATE OR DELETE ON projects FOR EACH ROW EXECUTE FUNCTION guard_system_project();

CREATE FUNCTION guard_system_page() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('builder.sample_maintenance', true)='on' THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.sample_key IS NOT NULL OR NEW.fixture_version IS NOT NULL OR EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND system_key IS NOT NULL) THEN
      RAISE EXCEPTION 'System sample pages can only be created by fixture initialization' USING ERRCODE='23514';
    END IF;
  ELSIF TG_OP='UPDATE' THEN
    IF OLD.sample_key IS NOT NULL OR NEW.sample_key IS DISTINCT FROM OLD.sample_key OR NEW.fixture_version IS DISTINCT FROM OLD.fixture_version
      OR (NEW.project_id IS DISTINCT FROM OLD.project_id AND EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND system_key IS NOT NULL)) THEN
      RAISE EXCEPTION 'System sample page cannot be changed' USING ERRCODE='23514';
    END IF;
  ELSIF OLD.sample_key IS NOT NULL THEN
    RAISE EXCEPTION 'System sample page cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_system_page_trigger BEFORE INSERT OR UPDATE OR DELETE ON pages FOR EACH ROW EXECUTE FUNCTION guard_system_page();

CREATE FUNCTION guard_system_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('builder.sample_maintenance', true)='on' THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    IF EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND system_key IS NOT NULL) THEN RAISE EXCEPTION 'System template assets are server controlled' USING ERRCODE='23514'; END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM projects WHERE id=OLD.project_id AND system_key IS NOT NULL) THEN RAISE EXCEPTION 'System template assets cannot be changed or deleted' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_system_asset_trigger BEFORE INSERT OR UPDATE OR DELETE ON assets FOR EACH ROW EXECUTE FUNCTION guard_system_asset();
