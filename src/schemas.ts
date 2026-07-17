import { z } from 'zod';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(jsonValueSchema),
]));

const fileCheckSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('exists') }).strict(),
  z.object({ op: z.literal('not_exists') }).strict(),
  z.object({ op: z.literal('sha256'), equals: z.string().regex(/^[a-fA-F0-9]{64}$/) }).strict(),
  z.object({ op: z.literal('contains'), text: z.string().min(1).max(100_000) }).strict(),
  z.object({ op: z.literal('json_equals'), pointer: z.string().max(2_000), value: jsonValueSchema }).strict(),
  z.object({ op: z.literal('min_size'), bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ op: z.literal('max_size'), bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(),
]);

const httpCheckSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('status'), equals: z.number().int().min(100).max(599) }).strict(),
  z.object({ op: z.literal('contains'), text: z.string().min(1).max(100_000) }).strict(),
  z.object({ op: z.literal('json_equals'), pointer: z.string().max(2_000), value: jsonValueSchema }).strict(),
]);

const gitCheckSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('branch'), equals: z.string().min(1).max(500) }).strict(),
  z.object({ op: z.literal('clean'), equals: z.boolean().optional() }).strict(),
  z.object({ op: z.literal('head'), equals: z.string().min(1).max(500) }).strict(),
  z.object({ op: z.literal('tag_exists'), tag: z.string().min(1).max(500) }).strict(),
  z.object({ op: z.literal('remote_contains'), commit: z.string().min(1).max(500), remote: z.string().regex(/^[A-Za-z0-9._-]+$/).optional() }).strict(),
]);

const npmCheckSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('version_exists'), version: z.string().min(1).max(256) }).strict(),
  z.object({ op: z.literal('dist_tag'), tag: z.string().min(1).max(256), equals: z.string().min(1).max(256) }).strict(),
]);

export const verifierSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), path: z.string().min(1).max(16_000), check: fileCheckSchema }).strict(),
  z.object({ kind: z.literal('http'), url: z.string().url().max(16_000), timeoutMs: z.number().int().min(100).max(30_000).optional(), check: httpCheckSchema }).strict(),
  z.object({ kind: z.literal('git'), cwd: z.string().min(1).max(16_000), check: gitCheckSchema }).strict(),
  z.object({
    kind: z.literal('npm'),
    package: z.string().regex(/^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/i),
    registry: z.string().url().max(16_000).optional(),
    check: npmCheckSchema,
  }).strict(),
  z.object({ kind: z.literal('manual'), instructions: z.string().min(1).max(20_000) }).strict(),
]);

export const defineContractSchema = z.object({
  statement: z.string().trim().min(5).max(20_000),
  subject: z.string().trim().min(1).max(4_000).optional(),
  verifier: verifierSchema,
  deadline: z.string().datetime({ offset: true }).optional(),
  metadata: z.record(jsonValueSchema).optional(),
}).strict();

export const attestationSchema = z.object({
  verdict: z.enum(['satisfied', 'violated', 'unknown']),
  summary: z.string().trim().min(3).max(20_000),
  evidence: z.record(jsonValueSchema).optional(),
  source: z.enum(['human', 'agent']).optional(),
}).strict();

export const verdictSchema = z.enum(['pending', 'satisfied', 'violated', 'unknown', 'retracted']);
