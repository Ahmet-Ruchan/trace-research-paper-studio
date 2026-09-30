"use client";

import { useEffect, useRef, useState } from "react";
import { BookMarked, X } from "lucide-react";
import { sectionMark } from "@/lib/reader-notes";
import { positionLabel, readPositions, savePosition, worthContinuing, type ReadingPosition } from "@/lib/reading-position";

/**
 * Kaldığın yer (`reading-position.ts`): okunan bölümü izleyen kanca, bölümün
 * başında "kaldığın yerden devam" şeridi ve kütüphane kartı için okuma.
 * Bölümler notların da kullandığı `data-note-section` işaretiyle bulunuyor.
 */

function storage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const elementFor = (place: ReadingPosition["place"], sectionId: string) =>
  document.querySelector<HTMLElement>(`[data-note-section="${CSS.escape(sectionMark(place, sectionId))}"]`);

/** Bölüme kaydırır; yapışkan başlığın altında kalmasın diye biraz boşlukla. */
export function scrollToSection(place: ReadingPosition["place"], sectionId: string) {
  const element = elementFor(place, sectionId);
  if (!element) return false;
  element.style.scrollMarginTop = "90px";
  element.scrollIntoView({ block: "start" });
  return true;
}

/**
 * Okunan bölümü izler: ekranın üst yarısındaki bölüm "okunuyor" sayılıyor.
 * Hızlı kaydırmada ara bölümler yazılmasın diye bir buçuk saniye bekleniyor.
 */
export function useReadingTracker(projectId: string, place: ReadingPosition["place"], sections: ReadonlyArray<{ id: string; title: string }>, enabled: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !sections.length) return;
    const byMark = new Map(sections.map((section, index) => [sectionMark(place, section.id), { ...section, index }]));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
        const section = visible ? byMark.get(visible.target.getAttribute("data-note-section") ?? "") : undefined;
        if (!section) return;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          savePosition(storage(), projectId, { place, sectionId: section.id, title: section.title.slice(0, 300), index: section.index, total: sections.length, at: new Date().toISOString() });
        }, 1500);
      },
      { rootMargin: "-25% 0px -60% 0px" },
    );
    // Bölümler çizildikten sonra bağlanıyor.
    const attach = setTimeout(() => {
      for (const section of sections) {
        const element = elementFor(place, section.id);
        if (element) observer.observe(element);
      }
    }, 100);
    return () => {
      clearTimeout(attach);
      clearTimeout(timer.current);
      observer.disconnect();
    };
  }, [enabled, place, projectId, sections]);
}

/** Bu cihazdaki bütün konumlar; kütüphane kartları için. */
export function useReadingPositions() {
  const [positions, setPositions] = useState<Record<string, ReadingPosition>>({});
  useEffect(() => {
    const load = setTimeout(() => setPositions(readPositions(storage())), 0);
    return () => clearTimeout(load);
  }, []);
  return positions;
}

/** Bölümün başında: "4. bölümde kalmıştın" ve devam düğmesi. */
export function ResumeBar({ projectId, place }: { projectId: string; place: ReadingPosition["place"] }) {
  const [position, setPosition] = useState<ReadingPosition>();
  useEffect(() => {
    const load = setTimeout(() => {
      const saved = readPositions(storage())[projectId];
      setPosition(saved && saved.place === place ? saved : undefined);
    }, 0);
    return () => clearTimeout(load);
  }, [place, projectId]);
  if (!worthContinuing(position)) return null;
  return (
    <div className="resume-bar" role="group" aria-label="Where you stopped">
      <BookMarked size={16} aria-hidden="true" />
      <p>You stopped at {positionLabel(position)}.</p>
      <button
        type="button"
        className="resume-go"
        onClick={() => {
          scrollToSection(place, position.sectionId);
          setPosition(undefined);
        }}
      >
        Continue reading
      </button>
      <button type="button" className="resume-close" aria-label="Start from the top instead" title="Start from the top instead" onClick={() => setPosition(undefined)}>
        <X size={14} />
      </button>
    </div>
  );
}
