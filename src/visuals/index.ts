/**
 * Paylaşılan render katmanı — TEK KAYNAK.
 *
 * Buradaki her şey iki host tarafından da derlenir:
 *   1. Next uygulaması (gerçek React)
 *   2. Plugin'in bağımsız viewer paketi (preact/compat, rolldown)
 *
 * Bu yüzden `src/visuals/**` altında `next/*`, `lucide-react`, `node:*` veya
 * `react-dom/server` KULLANILAMAZ. Kural eslint ile zorlanır.
 */
export { VisualRenderer } from "./visual-renderer";
export { InteractiveRenderer } from "./interactive-renderer";
export { MathText, sanitizeMathML } from "./math";
export { PrimerView } from "./teaching/primer";
export { DerivationView } from "./teaching/derivations";
export { QuizView } from "./teaching/quiz";
export { ApplicationGuideView } from "./teaching/application-guide";
export * from "./chart";
