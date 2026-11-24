/**
 * Pure helpers for the demo data dump (D-087). The build writes a plain-format `pg_dump`; the
 * app replays it without pg_restore (embedded-postgres ships no client tools): SQL runs as is,
 * each `COPY … FROM stdin;` block streams its rows through the COPY protocol.
 */

export type DumpPart = { kind: "sql"; text: string } | { kind: "copy"; statement: string; rows: string };

/** Splits a plain-format dump into SQL batches and COPY blocks, in order. */
export function splitDump(dump: string): DumpPart[] {
  const parts: DumpPart[] = [];
  const lines = dump.split("\n");
  let sql: string[] = [];
  const flush = () => {
    const text = sql.join("\n").trim();
    if (text) parts.push({ kind: "sql", text });
    sql = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^COPY .+ FROM stdin;$/.test(line)) {
      flush();
      const rows: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== "\\.") rows.push(lines[i++]);
      if (i >= lines.length) throw new Error(`Unterminated COPY block: ${line}`);
      parts.push({ kind: "copy", statement: line.slice(0, -1), rows: rows.length ? rows.join("\n") + "\n" : "" });
    } else if (/^\\(restrict|unrestrict) /.test(line)) {
      // psql-only guards that pg_dump 17.6+ writes around the dump; a plain SQL client rejects them.
      continue;
    } else {
      sql.push(line);
    }
  }
  flush();
  return parts;
}

/** What the app does with its database at launch. */
export type LaunchPlan = "restore" | "upgrade" | "ready";

/**
 * `restore` when there is no data yet (or the last restore did not finish), `upgrade` when this
 * version's schema differs from the data's (the user is told, then the dump is restored), else
 * `ready`. Migrations are compared by name, in order.
 */
export function launchPlan(state: { restored: boolean; migrations: string[] | null }, shipped: string[]): LaunchPlan {
  if (!state.restored || !state.migrations) return "restore";
  if (state.migrations.length !== shipped.length || state.migrations.some((m, i) => m !== shipped[i])) return "upgrade";
  return "ready";
}

/** Connection string for the app's own Postgres, which listens on 127.0.0.1 only. */
export function databaseUrl(o: { port: number; user: string; password: string; database: string }): string {
  return `postgresql://${encodeURIComponent(o.user)}:${encodeURIComponent(o.password)}@127.0.0.1:${o.port}/${o.database}`;
}
