import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import frServer from "../../messages/server/fr.json";
import { translateActionResult, translateServerMessage } from "@/i18n/server-messages";
import { formatBp, formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { formatKm } from "@/lib/format-locale";

type Tree = { [k: string]: string | Tree };

function leaves(t: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of leaves(v, key)) out.set(kk, vv);
  }
  return out;
}

/** ICU argument names used in a message: "{count, plural, …}" → count, "{name}" → name. */
const args = (s: string) => new Set([...s.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]));

describe("translations (D-081)", () => {
  const enLeaves = leaves(en as Tree);
  const frLeaves = leaves(fr as Tree);

  it("fr.json has exactly the keys of en.json", () => {
    expect([...frLeaves.keys()].filter((k) => !enLeaves.has(k))).toEqual([]);
    expect([...enLeaves.keys()].filter((k) => !frLeaves.has(k))).toEqual([]);
  });

  it("each French message uses the same arguments as the English one, and none is empty", () => {
    const bad = [...enLeaves].filter(([k, v]) => {
      const f = frLeaves.get(k) ?? "";
      return !f.trim() || [...args(v)].sort().join() !== [...args(f)].sort().join();
    });
    expect(bad.map(([k]) => k)).toEqual([]);
  });
});

/** The message literals the services throw, with `{}` for each `${…}` (same rules as the catalogue). */
function serviceTemplates(): Set<string> {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) files.push(p);
    }
  };
  walk("src/modules");
  walk("src/lib");
  const lit = String.raw`(\`(?:[^\`\\]|\\.)*\`|"(?:[^"\\]|\\.)*")`;
  const patterns = [
    new RegExp(String.raw`new (?:ConflictError|ValidationError)\(\s*` + lit, "gs"),
    new RegExp(String.raw`new DomainError\(\s*"[a-z_]+",\s*` + lit, "gs"),
    new RegExp(String.raw`\bmessage:\s*` + lit, "g"),
    // Field errors: `{ amountCents: ["Too high"] }` (not Prisma's `by: [...]` or zod's `path: [...]`).
    new RegExp(String.raw`\b(?!path\b|by\b|distinct\b)\w+: \[` + lit + String.raw`\]`, "g"),
  ];
  const out = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const re of patterns) {
      for (const m of src.matchAll(re)) {
        const raw = m[1];
        if (!/^["`](?:[A-Z][a-z]|\$\{)/.test(raw)) continue; // codes and enum values, not messages
        out.add(raw.startsWith('"') ? JSON.parse(raw) : raw.slice(1, -1).replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, "{}"));
      }
    }
  }
  return out;
}

describe("server messages in French (D-082)", () => {
  it("has a French template for every message the services throw", () => {
    const missing = [...serviceTemplates()].filter((t) => !(t in frServer));
    expect(missing).toEqual([]);
  });

  it("keeps every interpolated value", () => {
    for (const [enT, frT] of Object.entries(frServer)) expect(frT.split("{}").length, enT).toBe(enT.split("{}").length);
    expect(translateServerMessage("Only 2 of 5 available", "fr")).toBe("Seulement 2 disponible(s) sur 5");
    expect(translateServerMessage("Only €10.00 is due on FA-NTE-2026-000004", "fr")).toBe("Seulement €10.00 dû sur FA-NTE-2026-000004");
    expect(translateServerMessage("Customer abc not found", "fr")).toBe("Customer abc introuvable");
  });

  it("leaves English and unknown messages as they are, and translates field errors", () => {
    expect(translateServerMessage("Only 2 of 5 available", "en")).toBe("Only 2 of 5 available");
    expect(translateServerMessage("Something new", "fr")).toBe("Something new");
    const r = translateActionResult({ ok: false, error: { code: "validation", message: "Required", fieldErrors: { name: ["Name is required"] } } }, "fr");
    expect(r).toEqual({ ok: false, error: { code: "validation", message: "Obligatoire", fieldErrors: { name: ["Le nom est obligatoire"] } } });
  });
});

describe("number and date formats follow the locale", () => {
  it("formats in English by default and in French when asked", () => {
    expect(formatMoney(123_456)).toBe("€1,234.56");
    expect(formatMoney(123_456, { locale: "fr-FR" }).replace(/\s/g, " ")).toBe("1 234,56 €");
    expect(formatBp(2000)).toBe("20.00 %");
    expect(formatBp(2000, 2, "fr-FR")).toBe("20,00 %");
    expect(formatDate(new Date("2026-11-24"))).toBe("24 Nov 2026");
    expect(formatDate(new Date("2026-11-24"), "fr-FR")).toBe("24 nov. 2026");
    expect(formatKm(45_000, "fr-FR").replace(/\s/g, " ")).toBe("45 000 km");
  });
});
