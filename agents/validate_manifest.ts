/**
 * agents/validate_manifest.ts
 * Runtime validation of agent manifests against the JSON Schema + business rules.
 * Used by the Worker /dispatch route and CI pre-deploy checks.
 */
import Ajv from "ajv";
import addFormats from "ajv-formats";
import manifestSchema from "./manifest.schema.json";

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(manifestSchema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateAgentManifest(manifest: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // JSON Schema validation
  const schemaValid = validateSchema(manifest);
  if (!schemaValid && validateSchema.errors) {
    for (const err of validateSchema.errors) {
      errors.push(`${err.instancePath || "/"} ${err.message}`);
    }
  }

  if (!schemaValid) return { valid: false, errors, warnings };

  // Business-rule validation (beyond schema)
  const m = manifest as Record<string, unknown>;
  const alignment = m.alignment as Record<string, number>;
  const rateLimits = m.rate_limits as Record<string, number>;
  const models = m.models as Record<string, string>;

  // Alignment thresholds must be ordered correctly
  if (alignment.auto_block_below >= alignment.threshold) {
    errors.push("alignment.auto_block_below must be less than alignment.threshold");
  }
  if (
    alignment.require_human_review_below !== undefined &&
    (alignment.require_human_review_below < alignment.auto_block_below ||
      alignment.require_human_review_below > alignment.threshold)
  ) {
    errors.push("alignment.require_human_review_below must be between auto_block_below and threshold");
  }

  // Embedding dimension must be 768 for Google models
  const embeddingDim = m.embedding_dim as number;
  if (embeddingDim && embeddingDim !== 768 && models.embedding?.includes("text-embedding-004")) {
    warnings.push("embedding_dim should be 768 when using text-embedding-004");
  }

  // Rate limits sanity
  if (rateLimits.requests_per_minute > 600) {
    warnings.push("rate_limits.requests_per_minute > 600 may exceed Cloudflare Worker quotas");
  }

  // Model name format
  if (models.primary && !models.primary.includes("gemini")) {
    warnings.push(`models.primary '${models.primary}' is not a Gemini model — ensure ai_client.ts supports it`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// CLI usage: ts-node agents/validate_manifest.ts path/to/manifest.json
if (require.main === module) {
  const fs = require("fs");
  const path = process.argv[2];
  if (!path) { console.error("Usage: validate_manifest.ts <manifest.json>"); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(path, "utf-8"));
  const result = validateAgentManifest(manifest);
  if (result.warnings.length) console.warn("⚠️  Warnings:\n" + result.warnings.map(w => `  • ${w}`).join("\n"));
  if (result.valid) { console.log("✅  Manifest is valid"); process.exit(0); }
  else { console.error("❌  Errors:\n" + result.errors.map(e => `  • ${e}`).join("\n")); process.exit(1); }
}
