import { describe, expect, it } from "vitest";
import { buildStandaloneStory } from "./export-story";
import { exampleProject } from "./example-fixture";

describe("standalone story export", () => {
  it("exports a self-contained document with the project embedded", () => {
    const html = buildStandaloneStory(exampleProject);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain(exampleProject.story.title);
    expect(html).toContain("IntersectionObserver");
    expect(html).toContain("prefers-reduced-motion");
  });

  it("leaves no unfilled placeholder", () => {
    const html = buildStandaloneStory(exampleProject);
    // Tek tek saymak yerine deseni tarıyoruz: şablona yeni bir yer tutucu
    // eklenip burada doldurulmazsa ham etiket paylaşılan çıktıya sızardı.
    expect(html.match(/__TRACE_[A-Z_]+__/g)).toBeNull();
    expect(html).toContain(">story<");
  });

  it("paylaşılan çıktıya yerel stüdyo adresi gömmez", () => {
    const html = buildStandaloneStory(exampleProject);
    expect(html).toContain('id="trace-studio" type="application/json">{}<');
    // Paketin içinde "stüdyo zaten çalışıyorsa" bağlantısı sabit olarak var;
    // yasak olan, teslimatın ürettiği devir teslim adresinin gömülmesi.
    expect(html).not.toContain("?import=");
  });

  /**
   * Kaçış artık HTML varlıklarıyla değil JSON + < ile yapılıyor: proje
   * bir veri bloğunda taşınıyor, HTML'e yazılmıyor. Test mekanizmayı değil
   * GÜVENLİK ÖZELLİĞİNİ doğrular — düşman metin çalıştırılabilir HTML'e
   * dönüşmemeli.
   */
  it("neutralises untrusted story copy", () => {
    const project = structuredClone(exampleProject);
    project.story.title = '</title><script data-attack="true">alert(1)</script>';
    const html = buildStandaloneStory(project);

    expect(html).not.toContain('<script data-attack="true">');
    expect(html).not.toContain("</script><script");
    expect(html).toContain("\\u003cscript data-attack=");
  });

  it("survives regex-special sequences in project text", () => {
    const project = structuredClone(exampleProject);
    // "$&" replace() string sürümünde tüm eşleşmeyi geri koyar; fonksiyon
    // sürümü kullanmazsak proje metni burada bozulurdu.
    project.story.dek = "kazanç $& ve $` ile $' işaretleri";
    const html = buildStandaloneStory(project);
    expect(html).toContain("kazan\\u00e7 $& ve $` ile $' i\\u015faretleri".replace(/\\u00e7/, "ç").replace(/\\u015f/, "ş"));
  });
});
