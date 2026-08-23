import { useState } from "react";
import { useStrings } from "./language-context";
import { absoluteLink } from "@/lib/deep-link";

/**
 * "Şu iddiaya bak" düğmesi.
 *
 * Gerçek bir `<a href="#...">` olarak çiziliyor, çünkü sağ tık → bağlantıyı
 * kopyala ve orta tık → yeni sekme yalnızca gerçek bir bağlantıda çalışır.
 * Tıklama panoya da kopyalıyor; kullanıcının asıl istediği şey adres.
 *
 * Varsayılan davranış (hash'e atlama) engellenmiyor: çapaya gitmek zaten
 * doğru sonuç, üstelik geri tuşu da çalışır hâlde kalıyor.
 */
export function PermalinkButton({ hash, label }: { hash: string; label?: string }) {
  const t = useStrings();
  const [copied, setCopied] = useState(false);

  async function copy() {
    // `location.href` yerine mevcut adresin hash'ini değiştiriyoruz: `?sample=1`
    // ya da `?project=…` gibi sorgu parametreleri bağlantının parçası.
    const link = absoluteLink(window.location.href, hash);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Pano izni yoksa bağlantı yine de adres çubuğuna yazılır; kullanıcı
      // oradan kopyalayabilir. Sessizce geçmek, hata göstermekten iyi.
    }
  }

  return (
    <a
      className={copied ? "permalink is-copied" : "permalink"}
      href={hash}
      onClick={() => void copy()}
      title={label ?? t.permalinkTitle}
      aria-label={label ?? t.permalinkTitle}
    >
      <span aria-hidden="true">{copied ? "✓" : "#"}</span>
    </a>
  );
}
