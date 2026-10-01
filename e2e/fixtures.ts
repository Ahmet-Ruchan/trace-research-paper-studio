import { test as base } from "@playwright/test";

/**
 * Her paralel işçi kendi sunucusuna gidiyor (`playwright.config.ts`): ilk
 * işçi `TRACE_E2E_PORT`, ikincisi bir fazlası. `page` ve `request` adresi
 * buradan alıyor, testlerin yazdığı yollar değişmiyor.
 */
export const test = base.extend({
  baseURL: async ({}, provide, testInfo) => {
    const workers = Number(process.env.TRACE_E2E_WORKERS ?? 1);
    if (testInfo.parallelIndex >= workers) {
      throw new Error(`Worker ${testInfo.parallelIndex + 1} has no server: playwright.config.ts started ${workers}. Set TRACE_E2E_WORKERS instead of --workers.`);
    }
    await provide(`http://127.0.0.1:${Number(process.env.TRACE_E2E_PORT ?? 3217) + testInfo.parallelIndex}`);
  },
});

export { expect } from "@playwright/test";
