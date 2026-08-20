import { z } from "zod";

type JsonSchema = Record<string, unknown>;

function isObject(value: unknown): value is JsonSchema {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function permitsNull(schema: JsonSchema) {
  if (schema.type === "null") return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  return Array.isArray(schema.anyOf) && schema.anyOf.some(
    (candidate) => isObject(candidate) && candidate.type === "null",
  );
}

function nullable(schema: JsonSchema): JsonSchema {
  return permitsNull(schema) ? schema : { anyOf: [schema, { type: "null" }] };
}

function makeStrict(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(makeStrict);
  if (!isObject(schema)) return schema;

  const next = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, makeStrict(value)]),
  ) as JsonSchema;

  if (Array.isArray(next.oneOf)) {
    if (next.anyOf !== undefined) {
      throw new Error("An OpenAI strict schema cannot carry both oneOf and anyOf on the same node.");
    }
    // Zod discriminated unions use oneOf. Their literal discriminator keeps the
    // branches exclusive, while OpenAI's strict subset represents unions as anyOf.
    next.anyOf = next.oneOf;
    delete next.oneOf;
  }

  if (next.type !== "object" || !isObject(next.properties)) return next;

  const originalRequired = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : [],
  );
  const properties = Object.fromEntries(
    Object.entries(next.properties).map(([key, value]) => {
      const property = isObject(value) ? value : {};
      return [key, originalRequired.has(key) ? property : nullable(property)];
    }),
  );

  return {
    ...next,
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

export function openAiJsonSchema<T>(schema: z.ZodType<T>) {
  return makeStrict(z.toJSONSchema(schema)) as JsonSchema;
}

export function omitNullObjectFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitNullObjectFields);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== null)
      .map(([key, child]) => [key, omitNullObjectFields(child)]),
  );
}
