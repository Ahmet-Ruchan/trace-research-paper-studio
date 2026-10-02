/**
 * Kullanıcıya gösterilen hatalar, isteğin dilinden habersiz.
 *
 * Kütüphane kodu (depolama, ekip kaydı, yerel model adresi, web kaynakları,
 * sağlayıcılar) isteği görmüyor, hangi dilde cevap verileceğini bilemiyor.
 * Hatayı bir anahtar ve parametrelerle fırlatıyor: `.message` İngilizce
 * kalıyor (günlükler, testler, plugin), rota yanıtı yazarken anahtarı isteği
 * yapanın diline çeviriyor: `errorMessage(error, t.server.errors, yedek)`.
 *
 * Türkçesi `src/i18n/messages/server.ts`'te. Bu dosya `@/i18n`'e bağlı değil
 * ve olmamalı: plugin paketine giren modüller de buradan fırlatabiliyor.
 */
export const userErrorText = {
  // İstek
  requestBodyEmpty: () => "The request body is empty.",
  requestBodyInvalidJson: () => "The request body is not valid JSON.",
  requestTooLarge: () => "The request is too large.",
  signInToStudio: () => "Sign in to the studio first.",
  ownerOnlyData: () => "In a team only an owner can export, import or back up all the data: it holds every member's notes.",

  // Ekip
  teamBusy: () => "The team settings are busy. Please retry in a moment.",
  teamHasAccounts: () => "The team already has accounts. Sign in instead.",
  tooManyWrongPasswords: () => "Too many wrong passwords for this name. Try again in fifteen minutes.",
  wrongNameOrPassword: () => "The name or the password is wrong.",
  signInFirst: () => "Sign in first.",
  ownerOnlyTeam: () => "Only an owner can change the team.",
  nameTaken: () => "Someone in the team already has this name.",
  noSuchMember: () => "There is no such member.",
  lastOwner: () => "The last owner cannot be removed.",
  wrongCurrentPassword: () => "The current password is wrong.",
  nameRequired: () => "A name is required.",
  nameTooLong: (max: number) => `A name is at most ${max} characters.`,
  nameControlCharacters: () => "A name cannot hold control characters.",
  passwordTooShort: (min: number) => `A password has at least ${min} characters.`,
  passwordTooLong: (max: number) => `A password has at most ${max} characters.`,

  // Depolama: aynı dosyaya aynı anda yazan başka bir sekme ya da ajan
  accentBusy: () => "The Trace accent cycle is busy. Please retry in a moment.",
  tagsBusy: () => "The Trace tags are busy. Please retry in a moment.",
  studyBusy: () => "The study progress is busy. Please retry in a moment.",
  notesBusy: () => "Your notes are busy. Please retry in a moment.",
  readingListBusy: () => "The reading list is busy. Please retry in a moment.",
  aliasesBusy: () => "The concept links are busy. Please retry in a moment.",
  profileBusy: () => "The profile is busy. Please retry in a moment.",
  workLogBusy: () => "The work log is busy. Please retry in a moment.",
  templateIdInvalid: () => "The template id is not valid.",
  templateIdBuiltIn: () => "That id belongs to a built-in template; choose another name.",
  /** `issues` şablon denetiminin kendi (İngilizce) maddeleri, "; " ile birleşik. */
  templateUnusable: (issues: string) => `The template cannot be used: ${issues}.`,
  publicationIdInvalid: () => "The publication id is not valid.",
  publicationSourceGone: () => "The project is no longer in the library, so this publication cannot be updated.",

  // Yerel model adresi
  localAddressInvalid: (value: string, example: string) => `"${value}" is not a valid address. Use something like ${example}.`,
  localAddressCredentials: () => "The local model address must not carry credentials.",
  localAddressNotLoopback: (hostname: string) =>
    `Only an address on this machine is accepted (127.0.0.1, localhost or ::1); "${hostname}" is not one. The request leaves the Trace server, so any other address would let it reach hosts you never asked for.`,

  // Destekleyici web kaynakları
  sourceProtocol: () => "Only HTTP or HTTPS sources are supported.",
  sourceCredentials: () => "URLs carrying credentials are not supported.",
  sourceLocalNetwork: () => "Local network addresses cannot be used as sources.",
  sourcePrivateAddress: () => "Access to private IP addresses is blocked.",
  sourceUnsafeAddress: () => "The source did not resolve to a safe, public address.",
  sourceTooManyRedirects: () => "The source redirected too many times.",
  sourceStatus: (status: number) => `The source responded with ${status}.`,
  sourceNotText: () => "The source is neither HTML nor plain text.",
  sourceUnreadable: () => "The source content could not be read.",
  sourceTooLarge: () => "The source exceeds the content limit.",
  sourceFetchFailed: () => "The source could not be fetched.",

  // PDF'in metni ve sayfa görüntüsü (Poppler)
  pdftotextMissing: () =>
    "Reading the paper as text needs pdftotext, which was not found. Install Poppler (macOS: brew install poppler · Debian/Ubuntu: apt install poppler-utils · Windows: choco install poppler) and try again, or assign a cloud provider to the Evidence and Technical stages.",
  /** `detail` aracın kendi (ham) hata metni. */
  pdfTextFailed: (detail: string) => `The PDF text could not be extracted: ${detail}`,
  pdfNoText: () =>
    "This PDF has almost no extractable text — it is probably a scan. A local model cannot read it; assign a cloud provider to the Evidence and Technical stages, which receive the PDF itself.",
  popplerMissing: () => "Showing a quote on its page needs Poppler (pdftotext and pdftoppm), which was not found.",
  pageUnreadable: (detail: string) => `The page could not be read: ${detail}`,
  pdfNoPage: (page: number) => `The PDF has no page ${page}.`,

  // Model sağlayıcıları
  modelCouldNotProcessPdf: () => "The model could not process the PDF.",
  pdfProcessingTimedOut: () => "Processing the PDF timed out.",
  /** `stage` aşamanın (İngilizce) iç adı, ör. "Story planning". */
  stageEmptyResponse: (stage: string) => `The ${stage} stage returned an empty response.`,
  stageInvalidJson: (stage: string) => `The ${stage} stage did not return valid JSON.`,
  openRouterNoText: (model: string) =>
    `The OpenRouter model ${model} does not produce text/JSON output. Pick a model whose output modality is “text” for Trace tasks.`,
  openRouterNoStructured: (model: string) =>
    `The OpenRouter model ${model} does not support strict structured output. Pick another model from the compatible catalogue.`,
  localServerUnreachable: (endpoint: string) =>
    `No local model server answered at ${endpoint}. Start one — \`ollama serve\`, or LM Studio's local server — or point Trace at the address it is listening on.`,
  localServerStatus: (endpoint: string, status: number) => `The local model server at ${endpoint} answered with ${status}.`,
  /** `installed` yüklü modellerin listesi, virgülle birleşik. */
  localModelMissing: (endpoint: string, model: string, installed: string) =>
    `The local server at ${endpoint} does not have "${model}". Installed: ${installed}. Pull it first, for example \`ollama pull ${model}\`.`,

  // Sağlayıcı hatasının okuyucuya söylenişi (`publicError`)
  generationCancelled: () => "Generation cancelled.",
  /** Sağlayıcının adı; `local` yerel model sunucusu. */
  providerName: (label: string | undefined, local: boolean) => label ?? (local ? "Local model" : "Model provider"),
  /** "Google Gemini (model) · evidence task": hatanın hangi görevde olduğu. */
  providerTask: (provider: string, model: string | undefined, task: string | undefined) =>
    `${provider}${model ? ` (${model})` : ""}${task ? ` · ${task} task` : ""}`,
  providerTimedOut: (who: string, local: boolean) =>
    `${who} did not finish within ${local ? "15 minutes" : "120 seconds"}. Completed stages were kept; you can try again.${local ? " A smaller or non-thinking local model, or a cloud provider, will finish sooner." : ""}`,
  apiKeyInvalid: (provider: string) => `The ${provider} API key is invalid, or not authorised for this model.`,
  quotaExhausted: (provider: string) => `The ${provider} quota is exhausted, or its rate limit was reached. Completed stages were kept.`,
  insufficientCredit: (provider: string, model: string | undefined) =>
    `The ${provider} account does not have enough credit for this request.${model ? ` (${model})` : ""}`,
  modelUnavailable: (provider: string) => `The selected ${provider} model is not available to this API key. Pick another model and try again.`,
  providerUnreachable: (provider: string) => `${provider} cannot be reached right now. Completed stages were kept; you can try again.`,
  upstreamFailed: (who: string, diagnostic: string, fallback: string | undefined) =>
    `${who} failed at the upstream provider${diagnostic ? ` (${diagnostic})` : ""}.${fallback ? ` The compatible fallback ${fallback} failed as well.` : ""} Pick another text-only output + structured-output model from the compatible catalogue.`,
  schemaFailedTwice: () => "The model output failed the evidence schema on both attempts. No invented data was published; completed stages were kept.",
  processingFailed: () => "Something went wrong while processing the paper.",

  // Öğrenme katmanının bir parçası yazılamadığında kısa neden
  teachingKeyRefused: () => "The teaching model's key was refused.",
  teachingRateLimited: () => "The teaching model's rate limit was reached.",
  teachingTimedOut: () => "The teaching model did not answer in time.",
  teachingChecksFailed: () => "The model's answer did not pass the checks twice.",
  teachingFailed: () => "The teaching model returned an error.",
};

export type UserErrorText = typeof userErrorText;
export type UserErrorKey = keyof UserErrorText;

/** `[anahtar, ...parametreler]`: anahtara göre parametreler derlemede denetleniyor. */
export type UserErrorArgs = { [Key in UserErrorKey]: [key: Key, ...params: Parameters<UserErrorText[Key]>] }[UserErrorKey];

function render(text: UserErrorText, key: UserErrorKey, params: readonly unknown[]) {
  return (text[key] as (...args: readonly unknown[]) => string)(...params);
}

/** Okuyucunun kendi dilinde göreceği hata; `.message` her zaman İngilizce. */
export class UserFacingError extends Error {
  readonly key: UserErrorKey;
  readonly params: readonly unknown[];

  constructor(...[key, ...params]: UserErrorArgs) {
    super(render(userErrorText, key, params));
    this.name = "UserFacingError";
    this.key = key;
    this.params = params;
  }
}

/** Hata bu sözlükle yazılabiliyorsa metni; değilse `undefined`. */
export function userErrorMessage(error: unknown, text: UserErrorText = userErrorText): string | undefined {
  return error instanceof UserFacingError ? render(text, error.key, error.params) : undefined;
}

/**
 * Yanıta yazılacak hata metni: bilinen hata seçilen dilde, başka bir hata
 * kendi (ham) mesajıyla, hata bile olmayan bir şey `fallback` ile.
 */
export function errorMessage(error: unknown, text: UserErrorText, fallback: string): string {
  return userErrorMessage(error, text) ?? (error instanceof Error ? error.message : fallback);
}
