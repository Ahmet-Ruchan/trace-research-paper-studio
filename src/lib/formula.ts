/**
 * Güvenli formül değerlendirici.
 *
 * `.trace.json` projeleri güvenilmeyen kaynaklardan içe aktarılır. İnteraktif
 * modüllerin taşıdığı matematiksel ifadeler bu yüzden ASLA `eval` veya
 * `new Function` ile çalıştırılmaz. Bunun yerine kısıtlı bir dilbilgisi
 * ayrıştırılıp saf bir AST üzerinde yürütülür:
 *
 *   - yalnızca sayısal skalerler (dizi, nesne, string yok)
 *   - operatörler: + - * / % ^ ve tekli -
 *   - beyaz listedeki fonksiyonlar ve sabitler
 *   - döngü/atama/özellik erişimi dilbilgisinde YOK, dolayısıyla üretilemez
 *
 * Kaynak tükenmesine karşı üç sınır var: ifade uzunluğu, AST düğüm sayısı ve
 * ayrıştırma derinliği. Böylece hazırlanmış bir girdi tarayıcıyı kilitleyemez.
 */

export const FORMULA_LIMITS = {
  maxLength: 600,
  maxNodes: 240,
  maxDepth: 32,
} as const;

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaError";
  }
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

/** Tümü saf, sonlu-girdi → sonlu-çıktı sayısal fonksiyonlar. */
const FUNCTIONS: Record<string, { arity: number | [number, number]; fn: (...args: number[]) => number }> = {
  abs: { arity: 1, fn: Math.abs },
  sqrt: { arity: 1, fn: Math.sqrt },
  exp: { arity: 1, fn: Math.exp },
  ln: { arity: 1, fn: Math.log },
  log2: { arity: 1, fn: Math.log2 },
  log10: { arity: 1, fn: Math.log10 },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
  round: { arity: 1, fn: Math.round },
  sign: { arity: 1, fn: Math.sign },
  sin: { arity: 1, fn: Math.sin },
  cos: { arity: 1, fn: Math.cos },
  tan: { arity: 1, fn: Math.tan },
  tanh: { arity: 1, fn: Math.tanh },
  log: { arity: [1, 2], fn: (x, base) => (base === undefined ? Math.log(x) : Math.log(x) / Math.log(base)) },
  pow: { arity: 2, fn: Math.pow },
  min: { arity: [1, 8], fn: (...args) => Math.min(...args) },
  max: { arity: [1, 8], fn: (...args) => Math.max(...args) },
  clamp: { arity: 3, fn: (x, lo, hi) => Math.min(Math.max(x, lo), hi) },
  /** Tek bir logit'in softmax payı — ölçekleme etkisini göstermek için. */
  sigmoid: { arity: 1, fn: (x) => 1 / (1 + Math.exp(-x)) },
};

export type FormulaNode =
  | { kind: "number"; value: number }
  | { kind: "param"; name: string }
  | { kind: "unary"; op: "-"; operand: FormulaNode }
  | { kind: "binary"; op: "+" | "-" | "*" | "/" | "%" | "^"; left: FormulaNode; right: FormulaNode }
  | { kind: "call"; name: string; args: FormulaNode[] };

type Token =
  | { type: "number"; value: number }
  | { type: "name"; value: string }
  | { type: "op"; value: string }
  | { type: "paren"; value: "(" | ")" }
  | { type: "comma" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "comma" });
      index += 1;
      continue;
    }
    if ("+-*/%^".includes(char)) {
      tokens.push({ type: "op", value: char });
      index += 1;
      continue;
    }
    const numberMatch = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(input.slice(index));
    if (numberMatch) {
      tokens.push({ type: "number", value: Number(numberMatch[0]) });
      index += numberMatch[0].length;
      continue;
    }
    const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(index));
    if (nameMatch) {
      tokens.push({ type: "name", value: nameMatch[0] });
      index += nameMatch[0].length;
      continue;
    }
    throw new FormulaError(`Geçersiz karakter: "${char}" (konum ${index})`);
  }
  return tokens;
}

/** Öncelik tablosu; `^` sağa birleşimli, diğerleri sola. */
const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };

export function parseFormula(source: string): FormulaNode {
  if (typeof source !== "string" || !source.trim()) {
    throw new FormulaError("Formül boş olamaz");
  }
  if (source.length > FORMULA_LIMITS.maxLength) {
    throw new FormulaError(`Formül çok uzun (en fazla ${FORMULA_LIMITS.maxLength} karakter)`);
  }

  const tokens = tokenize(source);
  let position = 0;
  let nodeCount = 0;

  const countNode = () => {
    nodeCount += 1;
    if (nodeCount > FORMULA_LIMITS.maxNodes) {
      throw new FormulaError(`Formül çok karmaşık (en fazla ${FORMULA_LIMITS.maxNodes} düğüm)`);
    }
  };

  const peek = () => tokens[position];

  function parseExpression(minPrecedence: number, depth: number): FormulaNode {
    if (depth > FORMULA_LIMITS.maxDepth) {
      throw new FormulaError(`Formül çok derin (en fazla ${FORMULA_LIMITS.maxDepth} seviye)`);
    }
    let left = parseUnary(depth);
    for (;;) {
      const token = peek();
      if (!token || token.type !== "op") break;
      const precedence = PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      position += 1;
      const nextMin = token.value === "^" ? precedence : precedence + 1;
      const right = parseExpression(nextMin, depth + 1);
      countNode();
      left = { kind: "binary", op: token.value as "+", left, right };
    }
    return left;
  }

  function parseUnary(depth: number): FormulaNode {
    const token = peek();
    if (token && token.type === "op" && (token.value === "-" || token.value === "+")) {
      position += 1;
      // Matematik konvansiyonu: üs alma tekli eksiden daha sıkı bağlar, yani
      // -2^2 = -(2^2) = -4. Operandı `^` önceliğinden çözümlemek bunu sağlar;
      // -2*3 ise `*` daha gevşek olduğu için (-2)*3 olarak kalır.
      const operand = parseExpression(PRECEDENCE["^"], depth + 1);
      if (token.value === "+") return operand;
      countNode();
      return { kind: "unary", op: "-", operand };
    }
    return parsePrimary(depth);
  }

  function parsePrimary(depth: number): FormulaNode {
    const token = peek();
    if (!token) throw new FormulaError("Formül beklenmedik şekilde bitti");

    if (token.type === "number") {
      position += 1;
      countNode();
      return { kind: "number", value: token.value };
    }

    if (token.type === "paren" && token.value === "(") {
      position += 1;
      const inner = parseExpression(1, depth + 1);
      const closing = peek();
      if (!closing || closing.type !== "paren" || closing.value !== ")") {
        throw new FormulaError("Kapanmamış parantez");
      }
      position += 1;
      return inner;
    }

    if (token.type === "name") {
      position += 1;
      const next = peek();
      if (next && next.type === "paren" && next.value === "(") {
        const spec = FUNCTIONS[token.value];
        if (!spec) throw new FormulaError(`Bilinmeyen fonksiyon: ${token.value}`);
        position += 1;
        const args: FormulaNode[] = [];
        if (peek()?.type === "paren" && (peek() as { value: string }).value === ")") {
          position += 1;
        } else {
          for (;;) {
            args.push(parseExpression(1, depth + 1));
            const separator = peek();
            if (separator && separator.type === "comma") {
              position += 1;
              continue;
            }
            if (separator && separator.type === "paren" && separator.value === ")") {
              position += 1;
              break;
            }
            throw new FormulaError(`${token.value}( ... ) çağrısı kapanmadı`);
          }
        }
        const [minArity, maxArity] = Array.isArray(spec.arity)
          ? spec.arity
          : [spec.arity, spec.arity];
        if (args.length < minArity || args.length > maxArity) {
          throw new FormulaError(
            `${token.value} fonksiyonu ${minArity === maxArity ? minArity : `${minArity}-${maxArity}`} argüman alır (verilen ${args.length})`,
          );
        }
        countNode();
        return { kind: "call", name: token.value, args };
      }
      countNode();
      if (token.value in CONSTANTS) return { kind: "number", value: CONSTANTS[token.value] };
      return { kind: "param", name: token.value };
    }

    throw new FormulaError(`Beklenmeyen belirteç: ${JSON.stringify(token)}`);
  }

  const ast = parseExpression(1, 0);
  if (position !== tokens.length) {
    throw new FormulaError("Formülün sonunda çözümlenemeyen ifade var");
  }
  return ast;
}

/** AST'de geçen serbest değişkenleri toplar — parametre doğrulaması için. */
export function collectParams(node: FormulaNode, into = new Set<string>()): Set<string> {
  if (node.kind === "param") into.add(node.name);
  else if (node.kind === "unary") collectParams(node.operand, into);
  else if (node.kind === "binary") {
    collectParams(node.left, into);
    collectParams(node.right, into);
  } else if (node.kind === "call") node.args.forEach((arg) => collectParams(arg, into));
  return into;
}

export function evaluateNode(node: FormulaNode, params: Record<string, number>): number {
  switch (node.kind) {
    case "number":
      return node.value;
    case "param": {
      const value = params[node.name];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new FormulaError(`Parametre tanımsız veya sonlu değil: ${node.name}`);
      }
      return value;
    }
    case "unary":
      return -evaluateNode(node.operand, params);
    case "binary": {
      const left = evaluateNode(node.left, params);
      const right = evaluateNode(node.right, params);
      switch (node.op) {
        case "+": return left + right;
        case "-": return left - right;
        case "*": return left * right;
        case "/": return right === 0 ? Number.NaN : left / right;
        case "%": return right === 0 ? Number.NaN : left % right;
        case "^": return Math.pow(left, right);
      }
      return Number.NaN;
    }
    case "call": {
      const spec = FUNCTIONS[node.name];
      if (!spec) throw new FormulaError(`Bilinmeyen fonksiyon: ${node.name}`);
      return spec.fn(...node.args.map((arg) => evaluateNode(arg, params)));
    }
  }
}

/**
 * Ayrıştır + değerlendir. Sonlu olmayan sonuçlar `null` döner; çağıran taraf
 * bunu "tanımsız" olarak gösterir (grafikte boşluk, tabloda "—").
 */
export function evaluateFormula(source: string, params: Record<string, number>): number | null {
  const value = evaluateNode(parseFormula(source), params);
  return Number.isFinite(value) ? value : null;
}

export const FORMULA_FUNCTION_NAMES = Object.keys(FUNCTIONS);
export const FORMULA_CONSTANT_NAMES = Object.keys(CONSTANTS);
