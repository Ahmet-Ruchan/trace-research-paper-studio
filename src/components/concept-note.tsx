"use client";

import { Waypoints } from "lucide-react";
import { useT } from "@/i18n/client";
import type { ConceptLink } from "@/lib/concept-links";

/** Kütüphanedeki bir makalenin adresi: tam sayfa yükleme, stüdyo o projeyle açılıyor. */
export const paperHref = (projectId: string) => `/?project=${encodeURIComponent(projectId)}`;

export function PaperLink({ projectId, title }: { projectId: string; title: string }) {
  return <a href={paperHref(projectId)}>{title}</a>;
}

/**
 * Ön bilgi ve çalışma adımında kavramın kütüphanedeki izi: okuyucu onu başka
 * bir makalede çalıştıysa bunu, çalışmadıysa ama başka makaleler de
 * anlatıyorsa onları söylüyor. Bağ yoksa hiçbir şey çizilmiyor.
 */
export function ConceptNote({ link }: { link?: ConceptLink }) {
  const t = useT().learning.conceptNote;
  if (!link || (!link.studiedIn && !link.elsewhere.length)) return null;
  const others = link.elsewhere.filter((source) => source.projectId !== link.studiedIn?.projectId);
  return (
    <p className={link.studiedIn ? "concept-note is-studied" : "concept-note"}>
      <Waypoints size={13} aria-hidden="true" />
      {link.studiedIn ? (
        <span>
          {t.studiedIn}<PaperLink projectId={link.studiedIn.projectId} title={link.studiedIn.paperTitle} />
          {others.length ? t.othersToo(others.length) : null}{t.moveOn}
        </span>
      ) : (
        <span>
          {t.alsoIn}
          {others.slice(0, 2).map((source, index) => (
            <span key={source.projectId}>
              {index ? t.and : ""}
              <PaperLink projectId={source.projectId} title={source.paperTitle} />
            </span>
          ))}
          {others.length > 2 ? t.more(others.length - 2) : null}{t.end}
        </span>
      )}
    </p>
  );
}
