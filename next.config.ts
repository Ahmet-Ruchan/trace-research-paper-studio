import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Plugin teslimi siteyi 127.0.0.1 üzerinden açıyor ve kullanıcılar geliştirme
   * sunucusuna da aynı adresle geliyor. Bu host'lara izin verilmezse Next dev
   * kaynakları çapraz-köken sayıp engelliyor: JS parçaları yüklenmiyor ve
   * uygulama açılış ekranında sonsuza kadar takılıyor.
   */
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  /**
   * Servis çalışanı (`public/sw.js`) her açılışta yeniden denetlenmeli: eski bir
   * kopya önbellekte kalırsa yeni sürümün çevrimdışı kuralları hiç gelmezdi.
   */
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
