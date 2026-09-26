import { Fragment, useId, useState } from "react";
import { useStrings } from "./language-context";
import { markTerms, type TermEntry } from "@/lib/term-index";

/**
 * Terimi olduğu yerde açan metin. Tanım bir baloncukta değil, paragrafın
 * hemen altında açılıyor: telefonda da okunuyor, ekran okuyucu sırayı
 * izleyebiliyor ve kapatılana kadar yerinde kalıyor.
 */
export function TermParagraphs({
  paragraphs,
  entries,
  className,
}: {
  paragraphs: readonly string[];
  entries: readonly TermEntry[];
  className?: string;
}) {
  const t = useStrings();
  const [open, setOpen] = useState<{ paragraph: number; key: string }>();
  const cardId = useId();
  const marked = markTerms(paragraphs, entries, t.locale);

  return (
    <>
      {marked.map((segments, index) => (
        <Fragment key={index}>
          <p className={className}>
            {segments.map((segment, part) => {
              const entry = segment.entry;
              if (!entry) return <Fragment key={part}>{segment.text}</Fragment>;
              const expanded = open?.key === entry.key;
              return (
                <button
                  key={part}
                  type="button"
                  className="term-mark"
                  aria-expanded={expanded}
                  aria-controls={expanded ? cardId : undefined}
                  onClick={() => setOpen(expanded ? undefined : { paragraph: index, key: entry.key })}
                >
                  {segment.text}
                </button>
              );
            })}
          </p>
          {open?.paragraph === index ? (
            <TermCard id={cardId} entry={entries.find((entry) => entry.key === open.key)} onClose={() => setOpen(undefined)} />
          ) : null}
        </Fragment>
      ))}
    </>
  );
}

/** "Önce bunları bil": bölümün dayandığı ön bilgi kavramları, aynı kartla. */
export function SectionPrerequisites({ concepts }: { concepts: readonly TermEntry[] }) {
  const t = useStrings();
  const [open, setOpen] = useState<string>();
  const cardId = useId();
  if (!concepts.length) return null;
  return (
    <div className="term-prerequisites">
      <div className="term-chips">
        <span>{t.beforeThisSection}</span>
        {concepts.map((concept) => (
          <button
            key={concept.key}
            type="button"
            className="term-chip"
            aria-expanded={open === concept.key}
            aria-controls={open === concept.key ? cardId : undefined}
            onClick={() => setOpen(open === concept.key ? undefined : concept.key)}
          >
            {concept.term}
          </button>
        ))}
      </div>
      {open ? <TermCard id={cardId} entry={concepts.find((concept) => concept.key === open)} onClose={() => setOpen(undefined)} /> : null}
    </div>
  );
}

function TermCard({ id, entry, onClose }: { id: string; entry?: TermEntry; onClose: () => void }) {
  const t = useStrings();
  if (!entry) return null;
  return (
    <div className="term-card" id={id} role="note">
      <div className="term-card-head">
        <strong>{entry.term}</strong>
        <button type="button" onClick={onClose} aria-label={t.closeDefinition}>×</button>
      </div>
      <span className="term-card-body">{entry.definition}</span>
      {entry.whyItMatters ? (
        <span className="term-card-body"><b>{t.whyItMatters}</b> {entry.whyItMatters}</span>
      ) : null}
    </div>
  );
}
