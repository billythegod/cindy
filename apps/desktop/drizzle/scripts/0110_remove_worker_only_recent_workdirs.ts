import type Database from 'better-sqlite3';

function identity(raw: string, platform: NodeJS.Platform): string | null {
  let path = raw.trim().replace(/\\/g, '/');
  while (path.length > 1 && path.endsWith('/') && !/^[A-Za-z]:\/$/.test(path)) {
    path = path.slice(0, -1);
  }
  if (!path) return null;
  return platform === 'win32' && (/^[A-Za-z]:\//.test(path) || path.startsWith('//'))
    ? path.toLowerCase()
    : path;
}

function runForPlatform(db: Database.Database, platform: NodeJS.Platform): void {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (
    !['working_dir', 'workspace_kind', 'remote_host_id', 'source', 'orca_role'].every((column) =>
      columns.has(column),
    ) ||
    db.prepare('PRAGMA table_info(recent_workdirs)').all().length === 0
  )
    return;

  const timestamps = ['user_send_at', 'updated_at', 'created_at'].filter((column) =>
    columns.has(column),
  );
  if (timestamps.length === 0) return;
  const activity =
    timestamps.length === 1 ? timestamps[0] : `COALESCE(${timestamps.join(', ')}, 0)`;
  const rows = db
    .prepare(
      `SELECT working_dir AS path, orca_role AS role, source, ${activity} AS activity
     FROM sessions
     WHERE working_dir IS NOT NULL AND workspace_kind = 'project' AND remote_host_id IS NULL`,
    )
    .all() as Array<{ path: string; role: string | null; source: string | null; activity: number }>;
  const workerActivity = new Map<string, Set<number>>();
  const ordinaryProjects = new Set<string>();
  for (const row of rows) {
    const key = identity(row.path, platform);
    if (!key) continue;
    if (row.role !== 'worker') {
      ordinaryProjects.add(key);
      const base = key.split(
        /\/\.(?:cindy-worktrees|xdt-worktrees|worktrees)\/|\/\.claude\/worktrees\//,
      )[0];
      if (base) ordinaryProjects.add(base);
    } else if (row.source === 'desktop' || row.source === 'plugin') {
      const values = workerActivity.get(key) ?? new Set<number>();
      values.add(row.activity ?? 0);
      workerActivity.set(key, values);
    }
  }

  const recent = db
    .prepare('SELECT path, last_used_at AS activity FROM recent_workdirs')
    .all() as Array<{
    path: string;
    activity: number;
  }>;
  const remove = db.prepare('DELETE FROM recent_workdirs WHERE path = ?');
  for (const row of recent) {
    const key = identity(row.path, platform);
    if (!key || ordinaryProjects.has(key)) continue;
    if (workerActivity.get(key)?.has(row.activity)) remove.run(row.path);
  }
}

function run(db: Database.Database): void {
  runForPlatform(db, process.platform);
}

module.exports = { run, runForPlatform };
