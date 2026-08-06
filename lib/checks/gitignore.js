/**
 * @fileoverview .gitignore health check module
 *
 * Validates Spec-Up-T project .gitignore files against the live Spec-Up-T
 * boilerplate reference. Uses exact and fuzzy pattern matching, detects
 * duplicate patterns, and flags dangerous ignores (e.g. package.json, spec/).
 *
 * Comparison logic lives in gitignore-compare.js so this module stays focused
 * on provider I/O, reference fetching/caching, and health-check status mapping.
 *
 * Works in both Node.js and browser environments (uses global fetch).
 *
 * @author spec-up-t-healthcheck
 */

import { createHealthCheckResult, createErrorResult } from '../health-check-utils.js';
import {
  compareGitignore,
  extractPatterns,
  parseGitignore
} from './gitignore-compare.js';

/**
 * The identifier for this health check, used in reports and registries.
 * @type {string}
 */
export const CHECK_ID = 'gitignore';

/**
 * Human-readable name for this health check.
 * @type {string}
 */
export const CHECK_NAME = '.gitignore';

/**
 * Description of what this health check validates.
 * @type {string}
 */
export const CHECK_DESCRIPTION =
  'Validates .gitignore against the Spec-Up-T reference (exact/fuzzy matches, duplicates, dangerous patterns)';

/**
 * GitHub raw URL for the Spec-Up-T boilerplate .gitignore (source of truth).
 * @type {string}
 */
const BOILERPLATE_GITIGNORE_URL =
  'https://raw.githubusercontent.com/trustoverip/spec-up-t/master/src/install-from-boilerplate/boilerplate/gitignore';

/**
 * Cache duration for fetched boilerplate content (1 hour).
 * @type {number}
 */
const CACHE_DURATION = 60 * 60 * 1000;

/**
 * In-memory cache for the raw boilerplate .gitignore content.
 * @type {{content: string|null, lastFetch: number}}
 */
let contentCache = {
  content: null,
  lastFetch: 0
};

/**
 * Fetches the Spec-Up-T reference .gitignore content.
 *
 * Uses an in-memory cache to avoid repeated network calls. If a fetch fails
 * and a previously successful cache exists, the stale cache is returned.
 * There is no hardcoded fallback list — without a reference, the check fails.
 *
 * @returns {Promise<string>} Raw reference .gitignore content
 * @throws {Error} When the remote fetch fails and no cache is available
 * @private
 */
async function fetchBoilerplateContent() {
  const now = Date.now();

  if (contentCache.content && now - contentCache.lastFetch < CACHE_DURATION) {
    return contentCache.content;
  }

  try {
    const response = await fetch(BOILERPLATE_GITIGNORE_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();
    const patterns = extractPatterns(parseGitignore(content));

    if (patterns.length === 0) {
      throw new Error('No entries found in boilerplate .gitignore');
    }

    contentCache = { content, lastFetch: now };
    return content;
  } catch (error) {
    // Prefer a previously successful cache over failing the whole check offline
    if (contentCache.content) {
      return contentCache.content;
    }
    throw error;
  }
}

/**
 * Build human-readable detail lists from a compareGitignore() result.
 *
 * @param {ReturnType<typeof compareGitignore>} comparison - Comparison result
 * @returns {{errors: string[], warnings: string[], info: string[], missingEntries: string[]|undefined}}
 * @private
 */
function buildDetailMessages(comparison) {
  const { missing, extra, warnings: dangerous, duplicates, summary } = comparison;

  const errors = dangerous.map(
    item =>
      `Line ${item.lineA}: ${item.pattern} must not be ignored — ${item.reason}`
  );

  const warnings = [
    ...missing.map(
      item => `Missing required pattern: ${item.patternB}`
    ),
    ...duplicates.map(dup => {
      const lines = dup.lines.join(', ');
      const forms = dup.patterns.join(' / ');
      return `Duplicate ${dup.kind} pattern on lines ${lines}: ${forms}`;
    })
  ];

  const info = [
    `Compliance: ${summary.compliancePercent}% ` +
      `(${summary.exactMatches} exact, ${summary.fuzzyMatches} fuzzy, ` +
      `${summary.missingCount} missing, ${summary.extraCount} extra)`,
    ...extra.map(item => `Extra pattern (informational): ${item.patternA}`)
  ];

  const missingEntries =
    missing.length > 0 ? missing.map(item => item.patternB) : undefined;

  return { errors, warnings, info, missingEntries };
}

/**
 * Map comparison outcome to a health-check status and summary message.
 *
 * Priority: fail (dangerous patterns) > warn (missing/duplicates) > pass.
 *
 * @param {ReturnType<typeof compareGitignore>} comparison - Comparison result
 * @returns {{status: 'pass'|'warn'|'fail', message: string}}
 * @private
 */
function resolveStatus(comparison) {
  const { summary, warnings: dangerous, duplicates, missing } = comparison;

  if (dangerous.length > 0) {
    const patterns = dangerous.map(item => item.pattern).join(', ');
    return {
      status: 'fail',
      message: `Dangerous pattern${dangerous.length === 1 ? '' : 's'} in .gitignore: ${patterns}`
    };
  }

  if (missing.length > 0 || duplicates.length > 0) {
    const parts = [];
    if (missing.length > 0) {
      parts.push(
        `${missing.length} required ${missing.length === 1 ? 'entry' : 'entries'} missing: ${missing.map(m => m.patternB).join(', ')}`
      );
    }
    if (duplicates.length > 0) {
      parts.push(
        `${duplicates.length} duplicate ${duplicates.length === 1 ? 'pattern' : 'patterns'} found`
      );
    }
    return { status: 'warn', message: parts.join('; ') };
  }

  return {
    status: 'pass',
    message: `.gitignore contains all required entries (${summary.compliancePercent}% compliance)`
  };
}

/**
 * Validates the .gitignore file in a specification repository.
 *
 * 1. Fetches the Spec-Up-T reference .gitignore
 * 2. Verifies the project file exists and has patterns
 * 3. Compares with exact/fuzzy matching
 * 4. Flags dangerous ignores and duplicates
 *
 * @param {import('../providers.js').Provider} provider - Repository access provider
 * @returns {Promise<import('../health-check-utils.js').HealthCheckResult>}
 */
export async function checkGitignore(provider) {
  try {
    let referenceContent;
    try {
      referenceContent = await fetchBoilerplateContent();
    } catch (fetchError) {
      return createHealthCheckResult(
        CHECK_NAME,
        'fail',
        `Unable to fetch Spec-Up-T reference .gitignore: ${fetchError.message}`,
        {
          boilerplateUrl: BOILERPLATE_GITIGNORE_URL,
          fetchError: fetchError.message
        }
      );
    }

    const exists = await provider.fileExists('.gitignore');
    if (!exists) {
      return createHealthCheckResult(
        CHECK_NAME,
        'fail',
        '.gitignore file not found - repository should have a .gitignore file',
        {
          fileExists: false,
          recommendation: 'Create a .gitignore file based on the Spec-Up-T boilerplate',
          boilerplateUrl: BOILERPLATE_GITIGNORE_URL
        }
      );
    }

    const content = await provider.readFile('.gitignore');

    if (!content || content.trim().length === 0) {
      return createHealthCheckResult(
        CHECK_NAME,
        'fail',
        '.gitignore file is empty - should contain exclusion patterns',
        {
          fileExists: true,
          isEmpty: true,
          recommendation: 'Add exclusion patterns from the Spec-Up-T boilerplate',
          boilerplateUrl: BOILERPLATE_GITIGNORE_URL
        }
      );
    }

    const projectPatterns = extractPatterns(parseGitignore(content));
    if (projectPatterns.length === 0) {
      return createHealthCheckResult(
        CHECK_NAME,
        'fail',
        '.gitignore file contains no valid entries (only comments or empty lines)',
        {
          fileExists: true,
          hasOnlyComments: true,
          recommendation: 'Add valid exclusion patterns to .gitignore',
          boilerplateUrl: BOILERPLATE_GITIGNORE_URL
        }
      );
    }

    const comparison = compareGitignore(content, referenceContent);
    const { errors, warnings, info, missingEntries } = buildDetailMessages(comparison);
    const { status, message } = resolveStatus(comparison);

    const details = {
      fileExists: true,
      totalEntries: comparison.summary.totalInA,
      requiredEntriesCount: comparison.summary.totalInB,
      presentEntriesCount:
        comparison.summary.exactMatches + comparison.summary.fuzzyMatches,
      compliancePercent: comparison.summary.compliancePercent,
      exactMatches: comparison.summary.exactMatches,
      fuzzyMatches: comparison.summary.fuzzyMatches,
      missingEntries,
      extraEntries: comparison.extra.map(item => item.patternA),
      duplicates: comparison.duplicates,
      dangerousPatterns: comparison.warnings.map(item => item.pattern),
      sample: projectPatterns.slice(0, 10).map(entry => entry.pattern),
      boilerplateUrl: BOILERPLATE_GITIGNORE_URL,
      errors,
      warnings,
      info
    };

    return createHealthCheckResult(CHECK_NAME, status, message, details);
  } catch (error) {
    return createErrorResult(CHECK_NAME, error, {
      context: 'checking .gitignore file',
      provider: provider.type
    });
  }
}

/**
 * Clears the cached reference .gitignore content.
 * Useful in tests to force a fresh fetch.
 */
export function clearEntriesCache() {
  contentCache = {
    content: null,
    lastFetch: 0
  };
}

/**
 * Marks the cached reference as expired while keeping the content.
 * Useful in tests to exercise the stale-cache fallback path.
 */
export function expireEntriesCache() {
  if (contentCache.content) {
    contentCache.lastFetch = 0;
  }
}

export default checkGitignore;
