import { describe, expect, it } from "vitest";
import {
  FORMULA_LIMITS,
  FormulaError,
  collectParams,
  evaluateFormula,
  parseFormula,
} from "./formula";

describe("formül değerlendirici", () => {
  it("aritmetiği öncelik ve birleşim kurallarıyla çözer", () => {
    expect(evaluateFormula("2 + 3 * 4", {})).toBe(14);
    expect(evaluateFormula("(2 + 3) * 4", {})).toBe(20);
    expect(evaluateFormula("10 - 3 - 2", {})).toBe(5);
    expect(evaluateFormula("2 ^ 3 ^ 2", {})).toBe(512); // sağa birleşimli
    expect(evaluateFormula("-2 ^ 2", {})).toBe(-4);
  });

  it("parametreleri ve beyaz listedeki fonksiyonları çözer", () => {
    expect(evaluateFormula("d_k", { d_k: 64 })).toBe(64);
    expect(evaluateFormula("sqrt(d_k)", { d_k: 64 })).toBe(8);
    expect(evaluateFormula("1 / sqrt(d_k)", { d_k: 64 })).toBe(0.125);
    expect(evaluateFormula("max(n, d)", { n: 512, d: 64 })).toBe(512);
    expect(evaluateFormula("clamp(x, 0, 1)", { x: 5 })).toBe(1);
  });

  it("makaledeki karmaşıklık modellerini hesaplar", () => {
    // Tablo 1: self-attention O(n^2 * d) vs recurrent O(n * d^2)
    const params = { n: 512, d: 512 };
    expect(evaluateFormula("n^2 * d", params)).toBe(512 ** 2 * 512);
    expect(evaluateFormula("n * d^2", params)).toBe(512 * 512 ** 2);
    // n < d iken self-attention ucuzlar
    expect(evaluateFormula("n^2 * d", { n: 64, d: 512 })!).toBeLessThan(
      evaluateFormula("n * d^2", { n: 64, d: 512 })!,
    );
  });

  it("sabitleri tanır", () => {
    expect(evaluateFormula("pi", {})).toBeCloseTo(Math.PI);
    expect(evaluateFormula("ln(e)", {})).toBeCloseTo(1);
  });

  it("serbest değişkenleri toplar", () => {
    const params = collectParams(parseFormula("n^2 * d + sqrt(d_k)"));
    expect([...params].sort()).toEqual(["d", "d_k", "n"]);
  });

  it("tanımsız sonuçları null olarak döner", () => {
    expect(evaluateFormula("1 / 0", {})).toBeNull();
    expect(evaluateFormula("sqrt(0 - 1)", {})).toBeNull();
    expect(evaluateFormula("ln(0)", {})).toBeNull();
  });

  it("eksik parametreyi sessizce sıfır saymaz", () => {
    expect(() => evaluateFormula("n * d", { n: 4 })).toThrow(FormulaError);
  });
});

describe("formül güvenliği", () => {
  it("kod çalıştırma denemelerini reddeder", () => {
    const attacks = [
      "constructor.constructor('return 1')()",
      "globalThis.fetch('http://evil')",
      "process.exit(1)",
      "window.location='x'",
      "(()=>1)()",
      "a[0]",
      "x; y",
      "x = 1",
      "`${x}`",
    ];
    for (const attack of attacks) {
      expect(() => evaluateFormula(attack, { a: 1, x: 1, y: 1 })).toThrow(FormulaError);
    }
  });

  it("beyaz listede olmayan fonksiyonu reddeder", () => {
    expect(() => evaluateFormula("eval(1)", {})).toThrow(/Bilinmeyen fonksiyon/);
    expect(() => evaluateFormula("alert(1)", {})).toThrow(/Bilinmeyen fonksiyon/);
  });

  it("nokta ve köşeli parantez gibi erişim operatörlerini tanımaz", () => {
    expect(() => evaluateFormula("Math.random()", {})).toThrow(FormulaError);
    expect(() => evaluateFormula("obj.field", { obj: 1 })).toThrow(FormulaError);
  });

  it("yanlış argüman sayısını reddeder", () => {
    expect(() => evaluateFormula("sqrt(1, 2)", {})).toThrow(/arguments/);
    expect(() => evaluateFormula("clamp(1)", {})).toThrow(/arguments/);
  });

  it("kaynak tüketimini sınırlar", () => {
    const tooLong = `1${"+1".repeat(FORMULA_LIMITS.maxLength)}`;
    expect(() => evaluateFormula(tooLong, {})).toThrow(/too long/);

    const tooDeep = `${"(".repeat(FORMULA_LIMITS.maxDepth + 5)}1${")".repeat(FORMULA_LIMITS.maxDepth + 5)}`;
    expect(() => evaluateFormula(tooDeep, {})).toThrow(/too deep|too long/);

    const tooManyNodes = Array.from({ length: FORMULA_LIMITS.maxNodes }, () => "1").join("+");
    expect(() => evaluateFormula(tooManyNodes, {})).toThrow(/too complex|too long/);
  });

  it("dengesiz parantezi reddeder", () => {
    expect(() => evaluateFormula("(1 + 2", {})).toThrow(FormulaError);
    expect(() => evaluateFormula("1 + 2)", {})).toThrow(FormulaError);
    expect(() => evaluateFormula("sqrt(4", {})).toThrow(FormulaError);
  });

  it("boş girdiyi reddeder", () => {
    expect(() => evaluateFormula("", {})).toThrow(FormulaError);
    expect(() => evaluateFormula("   ", {})).toThrow(FormulaError);
  });
});
