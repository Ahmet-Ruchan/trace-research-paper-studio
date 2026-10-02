/**
 * Sağlayıcı hazırlanırken stüdyoya akan ilerleme metinleri (`model-runtime.ts`).
 *
 * İngilizcesi burada, Türkçesi `src/i18n/messages/server.ts`'te; rota isteğin
 * dilindekini `prepareProviderRuntime`'a veriyor. Ayrı ve bağımlılıksız bir
 * dosya, çünkü sözlük tarayıcı paketine de giriyor ve sağlayıcı SDK'larını
 * içine çekmemeli.
 */
export const providerProgressText = {
  pdfProcessing: "Preparing the PDF for the model.",
  pdfProcessingDetail: "Parsing the document pages and their visual layers.",
  geminiReceived: "PDF received; resolving its pages.",
  claudeSplit: "The PDF was split into visual and text layers for Claude.",
  localAnswering: "The local model is answering.",
  localAnsweringDetail: (model: string, endpoint: string) => `${model} · ${endpoint} · nothing leaves this machine`,
  openRouterRedirected: "Redirected to an OpenRouter structured model.",
  openRouterRedirectedDetail: (model: string, effective: string) =>
    `${model} is an image-output model; the Trace canvas JSON will be produced with ${effective}.`,
  openRouterPdfReady: "The PDF is ready for the OpenRouter request.",
  openRouterFallback: "Redirecting the OpenRouter endpoint.",
  openRouterFallbackDetail: (model: string, fallback: string) => `${model} returned an upstream error; retrying safely with ${fallback}.`,
  openAiReceived: "The PDF was taken into the OpenAI workspace.",
};

export type ProviderProgressText = typeof providerProgressText;
