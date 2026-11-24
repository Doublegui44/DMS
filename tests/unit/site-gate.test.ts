import { describe, expect, it } from "vitest";
import { checkBasicAuth, safeEqual } from "@/lib/site-gate";

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

describe("safeEqual", () => {
  it("matches equal strings only", () => {
    expect(safeEqual("demo", "demo")).toBe(true);
    expect(safeEqual("demo", "demO")).toBe(false);
    expect(safeEqual("demo", "demo1")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("checkBasicAuth", () => {
  it("accepts any username with the right password", () => {
    expect(checkBasicAuth(basic("anyone", "s3cret"), "s3cret")).toBe(true);
    expect(checkBasicAuth(basic("", "s3cret"), "s3cret")).toBe(true);
  });

  it("keeps colons inside the password", () => {
    expect(checkBasicAuth(basic("u", "a:b:c"), "a:b:c")).toBe(true);
  });

  it("accepts the scheme in any case", () => {
    expect(checkBasicAuth(basic("u", "pw").replace("Basic", "basic"), "pw")).toBe(true);
  });

  it.each([
    ["no header", null],
    ["wrong password", basic("u", "nope")],
    ["other scheme", "Bearer abc"],
    ["no credentials", "Basic"],
    ["no colon", `Basic ${Buffer.from("justtext").toString("base64")}`],
  ])("refuses %s", (_label, header) => expect(checkBasicAuth(header, "pw")).toBe(false));

  it("refuses everything when no password is configured", () => {
    expect(checkBasicAuth(basic("u", ""), "")).toBe(false);
  });
});
