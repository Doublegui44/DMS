import { describe, expect, it } from "vitest";
import { databaseUrl, launchPlan, splitDump } from "../../desktop/src/lib/dump";

describe("desktop demo dump", () => {
  const dump = [
    "SET client_encoding = 'UTF8';",
    "CREATE TABLE public.a (id text);",
    "",
    "COPY public.a (id) FROM stdin;",
    "x1",
    "x\\t2",
    "\\.",
    "",
    "COPY public.b (id) FROM stdin;",
    "\\.",
    "CREATE TRIGGER t AFTER UPDATE ON public.a FOR EACH ROW EXECUTE FUNCTION f();",
  ].join("\n");

  it("splits SQL and COPY blocks in order, rows ending with a newline", () => {
    expect(splitDump(dump)).toEqual([
      { kind: "sql", text: "SET client_encoding = 'UTF8';\nCREATE TABLE public.a (id text);" },
      { kind: "copy", statement: "COPY public.a (id) FROM stdin", rows: "x1\nx\\t2\n" },
      { kind: "copy", statement: "COPY public.b (id) FROM stdin", rows: "" },
      { kind: "sql", text: "CREATE TRIGGER t AFTER UPDATE ON public.a FOR EACH ROW EXECUTE FUNCTION f();" },
    ]);
  });

  it("skips the psql \\restrict guards of recent pg_dump versions", () => {
    expect(splitDump("\\restrict abc\nSET x = 1;\n\\unrestrict abc")).toEqual([{ kind: "sql", text: "SET x = 1;" }]);
  });

  it("refuses a truncated dump", () => {
    expect(() => splitDump("COPY public.a (id) FROM stdin;\nx1")).toThrow(/Unterminated/);
  });

  it("restores on first launch, after an unfinished restore and when the schema changed", () => {
    const shipped = ["20260101_init", "20260301_sales"];
    expect(launchPlan({ restored: false, migrations: null }, shipped)).toBe("restore");
    expect(launchPlan({ restored: false, migrations: shipped }, shipped)).toBe("restore");
    expect(launchPlan({ restored: true, migrations: ["20260101_init"] }, shipped)).toBe("upgrade");
    expect(launchPlan({ restored: true, migrations: ["20260101_init", "20260302_other"] }, shipped)).toBe("upgrade");
    expect(launchPlan({ restored: true, migrations: [...shipped] }, shipped)).toBe("ready");
  });

  it("builds a local connection string with escaped credentials", () => {
    expect(databaseUrl({ port: 54321, user: "dms", password: "a/b@c", database: "dms" })).toBe("postgresql://dms:a%2Fb%40c@127.0.0.1:54321/dms");
  });
});
