import { describe, expect, it } from "vitest";
import { describeDue } from "@/lib/review-schedule";
import { weekSummaryText } from "@/lib/work-export";
import { formatDuration, heatmap } from "@/lib/work-log";
import { messagesFor } from "./index";

/**
 * Çalışma saatinin Türkçe kelimeleri. İngilizce taraf kütüphane modüllerinin
 * kendi metni: ajan ve eklenti onu görüyor, değişmemeli.
 */

const en = messagesFor("en").focus;
const tr = messagesFor("tr").focus;

describe("çalışma saatinin Türkçesi", () => {
  it("süreyi Türkçe kısaltmalarla yazıyor, İngilizcesi kütüphanedekiyle aynı", () => {
    const seconds = [0, 30, 60, 45 * 60, 3600, 3900, 2 * 3600 + 15 * 60];
    expect(seconds.map((value) => tr.duration(value))).toEqual(["0 dk", "bir dakikadan az", "1 dk", "45 dk", "1 sa", "1 sa 5 dk", "2 sa 15 dk"]);
    expect(seconds.map((value) => en.duration(value))).toEqual(seconds.map((value) => formatDuration(value)));
  });

  it("haftalık özet bir bütün cümle; İngilizcesi varsayılanla aynı", () => {
    const summary = { from: "2026-09-21", seconds: 4.5 * 3600, previous: 2 * 3600, daysWorked: 2, best: { day: "2026-09-21", seconds: 3 * 3600 } };
    expect(weekSummaryText(summary, tr.weekSummary)).toBe("Geçen hafta 2 günde 4 sa 30 dk çalıştın, bir önceki haftadan 2 sa 30 dk fazla. En iyi günün: Pazartesi (3 sa).");
    expect(weekSummaryText({ from: "2026-09-21", seconds: 3600, previous: 3000, daysWorked: 1 }, tr.weekSummary)).toBe("Geçen hafta 1 günde 1 sa çalıştın, bir önceki haftayla hemen hemen aynı.");
    expect(weekSummaryText(summary, en.weekSummary)).toBe(weekSummaryText(summary));
  });

  it("takvimdeki ay adları arayüzün dilinde", () => {
    const today = new Date(2026, 0, 20);
    const map = heatmap(new Map(), { from: new Date(2025, 9, 1), to: today, today, weekStart: 1, goalMinutes: 240, locale: "tr" });
    expect(map.months.map((month) => month.label).slice(0, 4)).toEqual(["Eki", "Kas", "Ara", "Oca"]);
  });

  it("molada tekrar kartının ne zaman döneceği describeDue ile aynı günü söylüyor", () => {
    const at = "2026-09-28T10:00:00.000Z";
    const later = (days: number) => new Date(Date.parse(at) + days * 86_400_000).toISOString();
    expect(en.breakReview.comesBack(later(3), at)).toBe(`This card comes back ${describeDue(later(3), at)}.`);
    expect(tr.breakReview.comesBack(later(1), at)).toBe("Bu kart yarın yeniden geliyor.");
    expect(tr.breakReview.comesBack(later(3), at)).toBe("Bu kart 3 gün sonra yeniden geliyor.");
    expect(tr.breakReview.comesBack(at, at)).toBe("Bu kart hemen yeniden soruluyor.");
  });

  it("içe aktarmanın özeti sayıları Türkçe cümleyle veriyor", () => {
    expect(tr.provider.imported(0, false)).toBe("0 oturum eklendi. Hiçbir şey silinmedi.");
    expect(en.provider.imported(0, false)).toBe("0 sessions added. Nothing was removed.");
  });
});
