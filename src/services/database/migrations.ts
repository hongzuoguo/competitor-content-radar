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
  `
] as const
