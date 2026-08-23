export const MIGRATIONS = [
  `
    CREATE TABLE creators (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL CHECK (platform = 'douyin'),
      name TEXT NOT NULL,
      profile_url TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE works (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      platform_work_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      published_at TEXT NOT NULL,
      original_url TEXT NOT NULL,
      download_url TEXT,
      likes INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      collects INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX works_creator_published_idx ON works(creator_id, published_at DESC);

    CREATE TABLE metric_snapshots (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      captured_at TEXT NOT NULL,
      likes INTEGER NOT NULL,
      comments INTEGER NOT NULL,
      shares INTEGER NOT NULL,
      collects INTEGER NOT NULL
    );

    CREATE TABLE analyses (
      work_id TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
      transcript TEXT NOT NULL,
      result_json TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      token_usage_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE processing_jobs (
      work_id TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      error_code TEXT,
      error_message TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      summary_json TEXT
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,
  `
    CREATE TABLE works_v2 (
      id TEXT PRIMARY KEY,
      creator_id TEXT REFERENCES creators(id) ON DELETE CASCADE,
      platform_work_id TEXT,
      source_type TEXT NOT NULL CHECK (source_type IN ('douyin_monitor', 'douyin_url', 'local_file')),
      source_key TEXT NOT NULL,
      media_path TEXT,
      title TEXT NOT NULL,
      published_at TEXT NOT NULL,
      original_url TEXT,
      download_url TEXT,
      likes INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      collects INTEGER NOT NULL DEFAULT 0,
      UNIQUE(source_type, source_key)
    );

    INSERT INTO works_v2 (
      id, creator_id, platform_work_id, source_type, source_key, media_path,
      title, published_at, original_url, download_url, likes, comments, shares, collects
    ) SELECT
      id, creator_id, platform_work_id, 'douyin_monitor', 'douyin:' || platform_work_id, NULL,
      title, published_at, original_url, download_url, likes, comments, shares, collects
    FROM works;

    DROP TABLE works;
    ALTER TABLE works_v2 RENAME TO works;
    CREATE INDEX works_creator_published_idx ON works(creator_id, published_at DESC);
  `,
  `
    CREATE TABLE job_artifacts (
      work_id TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
      wav_path TEXT,
      transcript TEXT,
      updated_at TEXT NOT NULL
    );
  `,
  `
    ALTER TABLE job_artifacts ADD COLUMN existing_work_id TEXT REFERENCES works(id) ON DELETE SET NULL;
  `,
  `
    ALTER TABLE works ADD COLUMN ownership TEXT NOT NULL DEFAULT 'competitor'
      CHECK (ownership IN ('mine', 'competitor'));

    CREATE TABLE reports (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type = 'weekly'),
      period TEXT NOT NULL,
      collected_works INTEGER NOT NULL DEFAULT 0,
      viral_works INTEGER NOT NULL DEFAULT 0,
      warming_works INTEGER NOT NULL DEFAULT 0,
      likes_gained INTEGER NOT NULL DEFAULT 0,
      topic_summary TEXT NOT NULL DEFAULT '',
      generated_at TEXT NOT NULL
    );

    CREATE TABLE feishu_bindings (
      id TEXT PRIMARY KEY CHECK (id = 'default'),
      app_token TEXT NOT NULL,
      base_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      last_synced_at TEXT,
      error_message TEXT
    );

    CREATE TABLE feishu_table_bindings (
      table_key TEXT PRIMARY KEY,
      table_id TEXT NOT NULL UNIQUE
    );

    CREATE TABLE feishu_field_bindings (
      table_key TEXT NOT NULL,
      field_key TEXT NOT NULL,
      field_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      field_type TEXT NOT NULL,
      PRIMARY KEY (table_key, field_key),
      UNIQUE (table_key, field_id)
    );

    CREATE TABLE feishu_record_mappings (
      table_key TEXT NOT NULL,
      local_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      PRIMARY KEY (table_key, local_id),
      UNIQUE (table_key, record_id)
    );
  `,
  `
    CREATE TABLE model_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_template TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model_id TEXT NOT NULL,
      requires_api_key INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX model_profiles_one_active ON model_profiles(active) WHERE active = 1;
  `,
  `
    CREATE TABLE agent_audit_logs (
      id TEXT PRIMARY KEY,
      capability TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('local-api', 'mcp')),
      success INTEGER NOT NULL,
      error_code TEXT,
      duration_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX agent_audit_logs_created_idx ON agent_audit_logs(created_at DESC);
  `,
  `
    ALTER TABLE feishu_record_mappings ADD COLUMN first_synced_at TEXT;
  `,
  `
    DROP TABLE IF EXISTS reports;
    DELETE FROM runs WHERE kind = 'weekly';
  `,
  `
    ALTER TABLE creators ADD COLUMN ownership TEXT NOT NULL DEFAULT 'competitor';
  `
] as const
