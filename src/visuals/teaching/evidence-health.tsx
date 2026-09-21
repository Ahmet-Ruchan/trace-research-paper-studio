import { useStrings } from "../language-context";
import { evidenceHealth } from "@/lib/evidence-health";
import type { ResearchProject } from "@/lib/schema";

/**
 * Kanıt sağlığı paneli.
 *
 * Trace'in tek iddiası var: her cümle bir sayfaya bağlı. Bu panel o iddiayı
 * denetlenebilir kılıyor — tek tek iddialara tıklamadan analizin nerede
 * sağlam, nerede ince olduğu görünsün diye.
 *
 * Tek bir "sağlık puanı" bilerek YOK. Birleştirilmiş bir sayı, kötü kanıtı
 * iyi kanıtla ortalayıp gizler; okuyucunun ihtiyacı olan şey hangi bölümün
 * neden ince olduğu.
 */
export function EvidenceHealthView({
  project,
  onClaimSelect,
  onStrengthen,
  onCheckQuotes,
}: {
  project: ResearchProject;
  onClaimSelect?: (claimId: string) => void;
  /** Stüdyo verir: ince bölümü daha fazla kanıtla yeniden yazdırır. Görüntüleyici vermez. */
  onStrengthen?: (section: { area: "story" | "report"; id: string }) => void;
  /** Stüdyo verir: kullanıcıdan PDF'i alıp alıntıları sayfa metnine karşı denetler. Görüntüleyici vermez. */
  onCheckQuotes?: () => void;
}) {
  const t = useStrings();
  const health = evidenceHealth(project);
  const thin = health.sections.filter((section) => section.thin);
  const pageCount = health.pages.cited.length;

  return (
    <div className="health">
      <div className="health-stats">
        <Stat
          value={`${health.claims.verified}/${health.claims.total}`}
          label={t.healthVerified}
          note={t.healthVerifiedNote(health.claims.needsReview)}
          ratio={health.claims.verifiedRatio}
        />
        <Stat
          value={String(pageCount)}
          label={t.healthPages}
          note={
            health.pages.first !== undefined && health.pages.last !== undefined
              ? t.healthPagesNote(health.pages.first, health.pages.last, health.pages.gaps.length)
              : t.healthPagesNone
          }
          ratio={pageCount ? pageCount / (pageCount + health.pages.gaps.length) : 0}
        />
        <Stat
          value={`${health.usedClaimCount}/${health.claims.total}`}
          label={t.healthInUse}
          note={t.healthInUseNote(health.unusedClaims.length)}
          ratio={health.claims.total ? health.usedClaimCount / health.claims.total : 0}
        />
        {/* Denetlenmemiş proje "0/0" değil "denetlenmedi" der: kanıtı olmayan
            bir güvence bu panelin tam tersine çalışırdı. */}
        <Stat
          value={health.excerpts.checked ? `${health.excerpts.located}/${health.excerpts.total}` : "—"}
          label={health.excerpts.checked ? t.healthQuotes : t.healthQuotesUnchecked}
          note={
            health.excerpts.checked
              ? t.healthQuotesNote(health.excerpts.total - health.excerpts.located)
              : t.healthQuotesUncheckedNote
          }
          ratio={health.excerpts.checked && health.excerpts.total ? health.excerpts.located / health.excerpts.total : 0}
        />
      </div>

      {onCheckQuotes ? (
        <button type="button" className="health-check-quotes" onClick={onCheckQuotes}>
          {health.excerpts.checked ? t.healthQuotesRecheck : t.healthQuotesCheck}
        </button>
      ) : null}

      {health.excerpts.unlocatedClaims.length || health.excerpts.unlocatedOther.length ? (
        <section className="health-block">
          <h4>{t.healthQuotesMissing}</h4>
          <p className="health-note">
            {t.healthQuotesMissingNote(
              new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(
                // Bulunamayan bir alıntı listeleniyorsa denetim yapılmıştır ve tarihi vardır.
                new Date(health.excerpts.checkedAt ?? 0),
              ),
            )}
          </p>
          <ul className="health-unused">
            {health.excerpts.unlocatedClaims.map(({ claim, page }) => (
              <li key={claim.id}>
                {onClaimSelect ? (
                  <button type="button" onClick={() => onClaimSelect(claim.id)} lang={project.language}>
                    {claim.statement} <small>{t.healthQuotesPage(page)}</small>
                  </button>
                ) : (
                  <p lang={project.language}>{claim.statement} <small>{t.healthQuotesPage(page)}</small></p>
                )}
              </li>
            ))}
            {health.excerpts.unlocatedOther.map((item, index) => (
              <li key={`${item.owner}-${item.label}-${index}`}>
                <p lang={project.language}>{item.label} <small>{item.owner} · {t.healthQuotesPage(item.page)}</small></p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="health-block">
        <h4>{t.healthGrounding}</h4>
        <p className="health-note">{t.healthGroundingNote(health.grounding.fromPaper, health.grounding.fromWeb)}</p>
        <ul className="health-sources">
          {health.sources.map((source) => (
            <li key={source.id} className={source.claimCount ? "" : "is-unused"}>
              <span className={`health-source-type type-${source.type}`}>{source.type}</span>
              <span className="health-source-title">{source.title}</span>
              <span className="health-source-count">
                {source.claimCount ? t.healthCitations(source.claimCount) : t.healthNeverCited}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {health.pages.gaps.length ? (
        <section className="health-block">
          <h4>{t.healthGaps}</h4>
          {/* "Kaç sayfa atlandı" diyemiyoruz — PDF'in toplam sayfa sayısı
              projede yok. Söyleyebileceğimiz tek dürüst şey ilk ve son atıf
              ARASINDA kalan boşluk; o aralığın okunduğu kesin. */}
          <p className="health-note">{t.healthGapsNote(health.pages.first ?? 0, health.pages.last ?? 0)}</p>
          <div className="health-pages">
            {health.pages.gaps.map((page) => (
              <span key={page}>{page}</span>
            ))}
          </div>
        </section>
      ) : null}

      {thin.length ? (
        <section className="health-block">
          <h4>{t.healthThin}</h4>
          <p className="health-note">{t.healthThinNote}</p>
          <ul className="health-thin">
            {thin.map((section) => (
              <li key={`${section.area}-${section.id}`}>
                <span className="health-area">{section.area === "story" ? t.healthAreaStory : t.healthAreaReport}</span>
                <span className="health-thin-title" lang={project.language}>{section.title}</span>
                <span className="health-thin-count">
                  {t.healthSectionClaims(section.verifiedCount, section.claimCount)}
                </span>
                {onStrengthen ? (
                  <button type="button" className="health-strengthen" onClick={() => onStrengthen({ area: section.area, id: section.id })}>
                    {t.healthStrengthen}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {health.unusedClaims.length ? (
        <section className="health-block">
          <h4>{t.healthUnused}</h4>
          <p className="health-note">{t.healthUnusedNote}</p>
          <ul className="health-unused">
            {health.unusedClaims.map((claim) => (
              <li key={claim.id}>
                {onClaimSelect ? (
                  <button type="button" onClick={() => onClaimSelect(claim.id)} lang={project.language}>
                    {claim.statement}
                  </button>
                ) : (
                  <p lang={project.language}>{claim.statement}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ value, label, note, ratio }: { value: string; label: string; note: string; ratio: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return (
    <article className="health-stat">
      <strong>{value}</strong>
      <span>{label}</span>
      <div className="health-meter" role="img" aria-label={`${percent}%`}>
        <i className={percent >= 80 ? "is-good" : percent >= 50 ? "is-fair" : "is-weak"} style={{ width: `${percent}%` }} />
      </div>
      <small>{note}</small>
    </article>
  );
}
