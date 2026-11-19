import { describe, expect, it } from "vitest";
import { csvCell, parseCsv, rupees, toCsv } from "./csv";

describe("writing csv", () => {
  it("quotes what needs it and defuses formulas, but leaves numbers alone", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-5 off")).toBe("'-5 off");
    expect(csvCell(-12.5)).toBe("-12.5");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a", "b"], [["x", 1], ["y,z", 2]])).toBe('a,b\r\nx,1\r\n"y,z",2\r\n');
    expect(rupees(12_350)).toBe(123.5);
  });
});

describe("reading csv", () => {
  it("reads quotes, commas and line breaks inside quotes, and ignores a byte-order mark and blank lines", () => {
    const rows = parseCsv('﻿name,price\r\n"Latte, hot",200\r\n"He said ""hi""",5\r\n\r\n"two\nlines",1\r\n');
    expect(rows).toEqual([["name", "price"], ["Latte, hot", "200"], ['He said "hi"', "5"], ["two\nlines", "1"]]);
  });
  it("round-trips what it writes", () => {
    const data = [["a,b", 'c"d'], ["line\nbreak", "plain"]];
    expect(parseCsv(toCsv(["h1", "h2"], data)).slice(1)).toEqual(data);
  });
  it("copes with no trailing newline and empty input", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv("")).toEqual([]);
  });
});
