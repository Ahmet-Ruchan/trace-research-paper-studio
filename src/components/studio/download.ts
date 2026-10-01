/** Tarayıcıda bir dosya indirmek: bağlantı tıklanıp adres bir saniye sonra bırakılıyor. */
export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** İndirilen dosyaların adı: makale başlığından. */
export function projectSlug(project: { evidence: { paper: { title: string } } }) {
  return project.evidence.paper.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trace-story";
}
