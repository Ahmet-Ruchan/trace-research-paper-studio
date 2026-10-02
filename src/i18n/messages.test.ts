import { describe, expect, it } from "vitest";
import { stringsFor } from "@/visuals";
import { messagesFor } from "./messages";

/**
 * Sözlüklerin iki dili aynı biçimde mi ve Türkçe gerçekten çevrilmiş mi.
 *
 * `tr: typeof en` eksik anahtarı derlemede yakalıyor; burada çalışma anında
 * aynı şekil (dize ↔ dize, işlev ↔ işlev, aynı parametre sayısı) ve
 * çevrilmeden kopyalanmış İngilizce aranıyor. Kopya en sık hata: anahtar
 * eklenip Türkçe karşılığı "sonra" diye İngilizce bırakılıyor.
 */

type Leaf = { path: string; value: unknown };

function leaves(value: unknown, path = ""): Leaf[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, inner]) => leaves(inner, path ? `${path}.${key}` : key));
  }
  return [{ path, value }];
}

/** İşlevleri örnek değerlerle çağırıyor; nesne bekleyen işlev atılıyor. */
function sample(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "function") return undefined;
  for (const args of [[2, 3, 4, 5], ["Sample", "Other", "Third"], [1]]) {
    try {
      const result = (value as (...inner: unknown[]) => unknown)(...args);
      if (typeof result === "string") return result;
    } catch {
      // Başka türden parametre bekliyor; sıradaki örnek.
    }
  }
  return undefined;
}

/** Aynı kalabilecek metinler: adlar, kısaltmalar, simgeler, sayılar. */
const SAME_IN_BOTH = /^[\s\d\p{P}\p{S}]*$|^(Trace|Lab|PDF|arXiv|DOI|BibTeX|RIS|Zotero|Obsidian|Anki|MCP|API|JSON|Markdown|LaTeX|ICS|CSV|HTML|URL|OpenAI|Anthropic|Gemini|OpenRouter|Ollama|Claude|Codex|Antigravity|Ctrl|Esc|Enter|Tab|Shift|Alt|Cmd|Space|Model|Alarm|Profil|Test|Sprint|Pomodoro|Primer|Notebook|Slides|Ok|OK)$/u;
/** Türkçe tarafta kalmış İngilizce kelimeler: çevrilmemiş metnin işareti. */
const ENGLISH_WORDS = /\b(the|and|your|you|with|this|that|from|will|have|has|been|there|which|when|what|into|paper|papers|claim|claims|review|library|notes?)\b/i;
const ENGLISH_ALLOWED = /Trace|arXiv|BibTeX|Zotero|Obsidian|Anki|OpenAI|Anthropic|OpenRouter|Ollama|Claude|Codex|Antigravity|Notebook|Markdown|e\.g\.|https?:|\.trace\.json|notes\.json|<\w+>/;

function compare(english: Leaf[], turkish: Leaf[]) {
  const problems: string[] = [];
  const byPath = new Map(turkish.map((leaf) => [leaf.path, leaf.value]));
  for (const { path, value } of english) {
    if (!byPath.has(path)) {
      problems.push(`${path}: Türkçesi yok`);
      continue;
    }
    const other = byPath.get(path);
    if (typeof value !== typeof other) {
      problems.push(`${path}: türü farklı (${typeof value} / ${typeof other})`);
      continue;
    }
    if (typeof value === "function" && typeof other === "function" && value.length !== other.length && other.length > value.length) {
      problems.push(`${path}: Türkçe işlev daha çok parametre bekliyor (${value.length} / ${other.length})`);
    }
    const en = sample(value);
    const tr = sample(other);
    if (en === undefined || tr === undefined) continue;
    if (!tr.trim() && en.trim()) problems.push(`${path}: Türkçesi boş`);
    else if (en === tr && /[A-Za-z]{3,}/.test(en) && !SAME_IN_BOTH.test(en.trim())) problems.push(`${path}: çevrilmemiş ("${en.slice(0, 60)}")`);
    else if (ENGLISH_WORDS.test(tr.replace(new RegExp(ENGLISH_ALLOWED.source, "g"), "")) && en !== tr) problems.push(`${path}: Türkçede İngilizce kelime ("${tr.slice(0, 60)}")`);
  }
  for (const { path } of turkish) if (!english.some((leaf) => leaf.path === path)) problems.push(`${path}: İngilizcesi yok`);
  return problems;
}

describe("arayüz sözlükleri", () => {
  it("stüdyonun Türkçesi İngilizcesiyle aynı biçimde ve çevrilmiş", () => {
    expect(compare(leaves(messagesFor("en")), leaves(messagesFor("tr")))).toEqual([]);
  });

  it("görsellerin Türkçesi İngilizcesiyle aynı biçimde ve çevrilmiş", () => {
    const { locale: enLocale, ...english } = stringsFor("en", "en");
    const { locale: trLocale, ...turkish } = stringsFor("en", "tr");
    expect(enLocale).toBe(trLocale);
    expect(compare(leaves(english), leaves(turkish))).toEqual([]);
  });

  it("dil düğmesi ve ortak kelimeler", () => {
    const en = messagesFor("en").common;
    const tr = messagesFor("tr").common;
    expect(en.locale).toBe("en");
    expect(tr.locale).toBe("tr");
    expect(en.page(3)).toBe("p. 3");
    expect(tr.page(3)).toBe("s. 3");
    expect(en.papers(1)).toBe("1 paper");
    expect(en.papers(2)).toBe("2 papers");
    expect(tr.papers(2)).toBe("2 makale");
  });
});
