"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurationDatabase = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = require("fs");
const path = __importStar(require("path"));
const MIGRATIONS = [
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
class CurationDatabase {
    constructor(filePath) {
        this.filePath = filePath;
        (0, fs_1.mkdirSync)(path.dirname(filePath), { recursive: true });
        this.connection = new better_sqlite3_1.default(filePath);
        this.connection.pragma('foreign_keys = ON');
        this.connection.pragma('busy_timeout = 5000');
        this.connection.pragma('journal_mode = WAL');
        this.migrate();
    }
    close() {
        if (this.connection.open) {
            this.connection.close();
        }
    }
    migrate() {
        this.connection.exec(`
      CREATE TABLE IF NOT EXISTS curation_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
        const applied = new Set(this.connection.prepare('SELECT version FROM curation_schema_migrations').all()
            .map(row => row.version));
        for (const migration of MIGRATIONS) {
            if (applied.has(migration.version)) {
                continue;
            }
            this.connection.transaction(() => {
                this.connection.exec(migration.sql);
                this.connection.prepare('INSERT INTO curation_schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString());
            })();
        }
    }
}
exports.CurationDatabase = CurationDatabase;
//# sourceMappingURL=database.js.map