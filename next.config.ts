import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Plugin teslimi siteyi 127.0.0.1 üzerinden açıyor ve kullanıcılar geliştirme
   * sunucusuna da aynı adresle geliyor. Bu host'lara izin verilmezse Next dev
   * kaynakları çapraz-köken sayıp engelliyor: JS parçaları yüklenmiyor ve
   * uygulama açılış ekranında sonsuza kadar takılıyor.
   */
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
