import Database from 'better-sqlite3';
import {mkdirSync} from 'fs';
import * as path from 'path';

const MIGRATIONS: ReadonlyArray<{version: number; sql: string}> = [
  {
    version: 1,
    sql: `
      CREATE TABLE deletion_items (
        id INTEGER PRIMARY KEY,
        relative_path TEXT NOT NULL UNIQUE,
        media_type TEXT,
        file_size INTEGER,
        file_mtime INTEGER,
        file_hash TEXT,
        hash_algorithm TEXT,
        state TEXT NOT NULL CHECK (state IN ('PENDING', 'APPROVED', 'DECLINED', 'EXECUTED', 'ERROR')),
        current_cycle INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        approved_by_user_id TEXT,
        approved_by_user_name TEXT,
        approved_at TEXT,
        declined_by_user_id TEXT,
        declined_by_user_name TEXT,
        declined_at TEXT,
        executed_at TEXT,
        execution_error TEXT
      );

      CREATE INDEX deletion_items_state_idx ON deletion_items(state);

      CREATE TABLE deletion_requests (
        id INTEGER PRIMARY KEY,
        deletion_item_id INTEGER NOT NULL,
        cycle INTEGER NOT NULL,
        requested_by_user_id TEXT NOT NULL,
        requested_by_user_name TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        reason TEXT,
        withdrawn_at TEXT,
        FOREIGN KEY (deletion_item_id) REFERENCES deletion_items(id) ON DELETE RESTRICT
      );

      CREATE UNIQUE INDEX deletion_requests_active_user_idx
        ON deletion_requests(deletion_item_id, cycle, requested_by_user_id)
        WHERE withdrawn_at IS NULL;
      CREATE INDEX deletion_requests_item_idx ON deletion_requests(deletion_item_id, cycle);

      CREATE TABLE curation_events (
        id INTEGER PRIMARY KEY,
        deletion_item_id INTEGER NOT NULL,
        cycle INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        actor_user_id TEXT,
        actor_user_name TEXT,
        created_at TEXT NOT NULL,
        payload_json TEXT,
        FOREIGN KEY (deletion_item_id) REFERENCES deletion_items(id) ON DELETE RESTRICT
      );

      CREATE INDEX curation_events_item_idx ON curation_events(deletion_item_id, created_at);
    `
  }
];

export class CurationDatabase {
  readonly connection: Database.Database;

  constructor(readonly filePath: string) {
    mkdirSync(path.dirname(filePath), {recursive: true});
    this.connection = new Database(filePath);
    this.connection.pragma('foreign_keys = ON');
    this.connection.pragma('busy_timeout = 5000');
    this.connection.pragma('journal_mode = WAL');
    this.migrate();
  }

  close(): void {
    if (this.connection.open) {
      this.connection.close();
    }
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS curation_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const applied = new Set(
      (this.connection.prepare('SELECT version FROM curation_schema_migrations').all() as Array<{version: number}>)
        .map(row => row.version)
    );
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) {
        continue;
      }
      this.connection.transaction(() => {
        this.connection.exec(migration.sql);
        this.connection.prepare(
          'INSERT INTO curation_schema_migrations(version, applied_at) VALUES (?, ?)'
        ).run(migration.version, new Date().toISOString());
      })();
    }
  }
}
