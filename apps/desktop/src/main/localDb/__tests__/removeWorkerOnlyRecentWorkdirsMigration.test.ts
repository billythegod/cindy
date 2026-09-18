import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration =
  require('../../../../drizzle/scripts/0110_remove_worker_only_recent_workdirs.ts') as {
    runForPlatform: (db: Database.Database, platform: NodeJS.Platform) => void;
  };
const historical = require('../../../../drizzle/scripts/0106_retain_all_recent_workdirs.ts') as {
  runForPlatform: (db: Database.Database, platform: NodeJS.Platform) => void;
};
let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, working_dir TEXT, workspace_kind TEXT DEFAULT 'project',
      source TEXT DEFAULT 'desktop', orca_role TEXT, remote_host_id TEXT,
      status TEXT DEFAULT 'active', user_send_at INTEGER, updated_at INTEGER DEFAULT 2000,
      created_at INTEGER DEFAULT 1000
    );
    CREATE TABLE recent_workdirs (path TEXT PRIMARY KEY, last_used_at INTEGER NOT NULL);
    CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT, content TEXT);
  `);
});
afterEach(() => db.close());

function session(id: string, path: string, role: 'worker' | 'lead' | null = 'worker') {
  db.prepare('INSERT INTO sessions (id, working_dir, orca_role) VALUES (?, ?, ?)').run(
    id,
    path,
    role,
  );
}
function project(path: string, timestamp = 2000) {
  db.prepare('INSERT INTO recent_workdirs VALUES (?, ?)').run(path, timestamp);
}
function paths(): string[] {
  return (
    db.prepare('SELECT path FROM recent_workdirs ORDER BY path').all() as Array<{ path: string }>
  ).map((row) => row.path);
}

describe('remove worker-only recent projects', () => {
  it('corrects historical backfill on upgrade and fresh replay without deleting task data', () => {
    for (const status of ['active', 'archived', 'deleted']) {
      session(status, `/runs/${status}/work`);
      db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, status);
      db.prepare('INSERT INTO messages VALUES (?, ?, ?)').run(status, status, 'preserved answer');
    }
    session('ordinary', '/repo', null);
    project('/explicit-empty');
    historical.runForPlatform(db, 'linux');
    expect(paths()).toHaveLength(5);
    const sessionsBefore = db.prepare('SELECT * FROM sessions').all();
    const messagesBefore = db.prepare('SELECT * FROM messages').all();

    migration.runForPlatform(db, 'linux');
    migration.runForPlatform(db, 'linux');

    expect(paths()).toEqual(['/explicit-empty', '/repo']);
    expect(db.prepare('SELECT * FROM sessions').all()).toEqual(sessionsBefore);
    expect(db.prepare('SELECT * FROM messages').all()).toEqual(messagesBefore);
  });

  it.each(['active', 'archived', 'deleted'])(
    'protects projects used by a %s ordinary task',
    (status) => {
      session('worker', '/shared');
      session('ordinary', '/shared', null);
      db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, 'ordinary');
      project('/shared');

      migration.runForPlatform(db, 'linux');

      expect(paths()).toEqual(['/shared']);
    },
  );

  it('protects leads, normal managed-worktree use, and newer explicit registrations', () => {
    session('worker-lead', '/lead');
    session('lead', '/lead', 'lead');
    project('/lead');
    session('worker-base', '/repo');
    session('normal-worktree', '/repo/.cindy-worktrees/task', null);
    project('/repo');
    session('worker-old', '/explicit-after-worker');
    project('/explicit-after-worker', 3000);

    migration.runForPlatform(db, 'linux');

    expect(paths()).toEqual(['/explicit-after-worker', '/lead', '/repo']);
  });

  it('does not use remote or dialogue history as proof to remove a local project', () => {
    session('remote', '/remote');
    db.exec("UPDATE sessions SET remote_host_id = 'ssh' WHERE id = 'remote'");
    project('/remote');
    session('dialogue', '/dialogue');
    db.exec("UPDATE sessions SET workspace_kind = 'dialogue' WHERE id = 'dialogue'");
    project('/dialogue');
    project('/no-history');

    migration.runForPlatform(db, 'linux');

    expect(paths()).toEqual(['/dialogue', '/no-history', '/remote']);
  });

  it('preserves independent registrations made before later worker activity', () => {
    session('worker', '/explicit-before-worker');
    project('/explicit-before-worker', 1500);
    session('sent-worker', '/explicit-after-send');
    db.exec("UPDATE sessions SET user_send_at = 1000, updated_at = 3000 WHERE id = 'sent-worker'");
    project('/explicit-after-send', 2000);

    migration.runForPlatform(db, 'linux');

    expect(paths()).toEqual(['/explicit-after-send', '/explicit-before-worker']);
  });

  it('matches Windows separator, trailing slash, UNC and Unicode casing variants', () => {
    session('worker', 'D:\\École\\Run\\');
    project('d:/école/run');
    session('worker-shared', '//Server/Share/Project');
    session('normal-shared', '\\\\server\\share\\PROJECT\\', null);
    project('//SERVER/SHARE/PROJECT/');

    migration.runForPlatform(db, 'win32');

    expect(paths()).toEqual(['//SERVER/SHARE/PROJECT/']);
  });

  it('keeps POSIX path identities case-sensitive', () => {
    session('worker', '/Runs/work');
    session('ordinary', '/runs/work', null);
    project('/Runs/work');
    project('/runs/work');

    migration.runForPlatform(db, 'linux');

    expect(paths()).toEqual(['/runs/work']);
  });

  it('leaves unclassified legacy schemas unchanged', () => {
    db.exec('ALTER TABLE sessions DROP COLUMN orca_role');
    project('/unknown');

    migration.runForPlatform(db, 'linux');

    expect(paths()).toEqual(['/unknown']);
  });
});
