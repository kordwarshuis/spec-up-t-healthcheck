/**
 * @fileoverview Term reference validation health check
 *
 * Mirrors the Unresolved References / Dangling Definitions reports produced
 * during spec-up-t menu option 4 (collect external references / render).
 *
 * This check analyzes markdown source so it can run in both Node.js (CLI /
 * spec-up-t healthCheck) and browser environments (GitHubUi) without requiring
 * a prior render.
 *
 * Logic (aligned with validateReferences in spec-up-t):
 * - Unresolved: [[ref:]] / [[iref:]] terms with no matching [[def:]] or [[tref:]]
 * - Dangling: [[def:]] terms (or first alias) never used by [[ref:]] / [[iref:]]
 *
 * @author spec-up-t-healthcheck
 */

import { createHealthCheckResult, createErrorResult } from '../health-check-utils.js';

/**
 * Unique identifier for this health check.
 * @type {string}
 */
export const CHECK_ID = 'term-references';

/**
 * Human-readable name for this health check.
 * @type {string}
 */
export const CHECK_NAME = 'Term References';

/**
 * Description of what this health check validates.
 * @type {string}
 */
export const CHECK_DESCRIPTION =
  'Detects unresolved [[ref:]] references and dangling [[def:]] definitions';

/**
 * Matches template tags like [[def: term]], [[ref: term]], [[tref: spec, term]].
 * Group 1 = tag type, Group 2 = arguments.
 * @type {RegExp}
 */
const TEMPLATE_TAG_REGEX = /\[\[\s*([^\s[\]:]+):?\s*([^\]\n]+)?\]\]/gim;

/**
 * Splits comma-separated template tag arguments.
 * @type {RegExp}
 */
const ARGS_SEPARATOR = /\s*,+\s*/;

/**
 * Normalizes a term the same way spec-up-t validateReferences does:
 * whitespace → hyphen, lowercase.
 *
 * @param {string} term - Raw term text
 * @returns {string} Normalized term id fragment
 */
function normalizeTerm(term) {
  return String(term || '').replace(/\s+/g, '-').toLowerCase();
}

/**
 * Splits template-tag arguments into trimmed non-empty strings.
 *
 * @param {string} argsText - Raw args from inside [[type: args]]
 * @returns {string[]} Parsed arguments
 */
function parseArgs(argsText) {
  if (!argsText?.trim()) {
    return [];
  }
  return argsText.split(ARGS_SEPARATOR).map(a => a.trim()).filter(Boolean);
}

/**
 * Strips fenced code blocks so tags inside examples are ignored.
 *
 * @param {string} content - Markdown content
 * @returns {string} Content with fenced code blocks removed
 */
function stripFencedCodeBlocks(content) {
  return content.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');
}

/**
 * Extracts definitions, references, and tref terms from markdown content.
 *
 * @param {string} content - Markdown file content
 * @returns {{definitions: Array<{term: string, alias: string|null}>, references: string[], trefTerms: string[]}}
 */
function extractTerminology(content) {
  const definitions = [];
  const references = [];
  const trefTerms = [];
  const searchable = stripFencedCodeBlocks(content);

  TEMPLATE_TAG_REGEX.lastIndex = 0;
  let match;
  while ((match = TEMPLATE_TAG_REGEX.exec(searchable)) !== null) {
    const type = (match[1] || '').toLowerCase();
    const args = parseArgs(match[2] || '');

    if (type === 'def' && args.length > 0) {
      // Match parseDef: store primary term + first alias only for dangling checks
      definitions.push({
        term: args[0],
        alias: args[1] || null,
        allTerms: args
      });
    } else if ((type === 'ref' || type === 'iref') && args.length > 0) {
      // Match parseRef / parseIref: first arg is the referenced term
      references.push(args[0]);
    } else if (type === 'tref' && args.length >= 2) {
      // tref args: [externalSpec, term, ...aliases] — all become resolvable ids
      trefTerms.push(...args.slice(1));
    }
  }

  return { definitions, references, trefTerms };
}

/**
 * Builds the set of normalized term ids that can resolve a [[ref:]].
 *
 * @param {Array<{allTerms: string[]}>} definitions - Local definitions
 * @param {string[]} trefTerms - Terms introduced via [[tref:]]
 * @returns {Set<string>} Normalized resolvable term ids
 */
function buildResolvableTermIds(definitions, trefTerms) {
  const ids = new Set();
  for (const def of definitions) {
    for (const term of def.allTerms) {
      ids.add(normalizeTerm(term));
    }
  }
  for (const term of trefTerms) {
    ids.add(normalizeTerm(term));
  }
  return ids;
}

/**
 * Finds references that have no matching definition or tref.
 * Deduplicates like spec-up-t validateReferences ([...new Set(references)]).
 *
 * @param {string[]} references - Raw reference terms
 * @param {Set<string>} resolvableIds - Normalized ids that exist
 * @returns {string[]} Unresolved reference terms (original spelling, unique)
 */
function findUnresolvedReferences(references, resolvableIds) {
  const unresolved = [];
  for (const ref of new Set(references)) {
    if (!resolvableIds.has(normalizeTerm(ref))) {
      unresolved.push(ref);
    }
  }
  return unresolved;
}

/**
 * Finds definitions that are never referenced.
 * Matches validateReferences: a def is kept if term OR first alias is referenced.
 *
 * @param {Array<{term: string, alias: string|null}>} definitions - Local definitions
 * @param {string[]} references - Raw reference terms
 * @returns {string[]} Primary terms of dangling definitions
 */
function findDanglingDefinitions(definitions, references) {
  const referencedIds = new Set(references.map(normalizeTerm));
  const dangling = [];

  for (const def of definitions) {
    const candidates = [def.term, def.alias].filter(Boolean);
    const isReferenced = candidates.some(term => referencedIds.has(normalizeTerm(term)));
    if (!isReferenced) {
      dangling.push(def.term);
    }
  }

  return [...new Set(dangling)];
}

/**
 * Loads markdown file paths from specs.json (spec_directory + markdown_paths).
 * Falls back to common directories when specs.json is missing or incomplete.
 *
 * @param {import('../providers.js').Provider} provider - File provider
 * @returns {Promise<string[]>} Markdown file paths to analyze
 */
async function discoverMarkdownFiles(provider) {
  const fromSpecs = await getPathsFromSpecsJson(provider);
  if (fromSpecs.length > 0) {
    return fromSpecs;
  }
  return discoverMarkdownFilesFallback(provider);
}

/**
 * Joins path segments without Node path APIs (browser-safe).
 * Strips leading ./ and collapses duplicate slashes.
 *
 * @param {...string} segments - Path segments
 * @returns {string} Joined relative path
 */
function joinPath(...segments) {
  return segments
    .filter(segment => segment && segment !== '')
    .map(segment => String(segment).replace(/^\.\//, '').replace(/\/$/, ''))
    .join('/')
    .replace(/\/+/g, '/');
}

/**
 * Reads markdown paths from specs.json for every configured spec.
 *
 * Includes:
 * - Files listed in markdown_paths under spec_directory
 * - All .md files in spec_terms_directory (where [[def:]] / [[tref:]] live)
 *
 * @param {import('../providers.js').Provider} provider - File provider
 * @returns {Promise<string[]>} Paths relative to repo root
 */
async function getPathsFromSpecsJson(provider) {
  try {
    const exists = await provider.fileExists('specs.json');
    if (!exists) {
      return [];
    }

    const data = JSON.parse(await provider.readFile('specs.json'));
    const paths = [];

    for (const spec of data.specs || []) {
      const specDir = joinPath(spec.spec_directory || 'spec');
      const markdownPaths = Array.isArray(spec.markdown_paths) ? spec.markdown_paths : [];

      for (const md of markdownPaths) {
        if (typeof md === 'string' && md.trim()) {
          paths.push(joinPath(specDir, md.replace(/^\//, '')));
        }
      }

      // Term definition / tref files are inserted into the build via term-index;
      // they are not always listed in markdown_paths, so scan the terms directory.
      const termsDirName = spec.spec_terms_directory || 'terms-definitions';
      const termsDir = joinPath(specDir, termsDirName);
      const termFiles = await listMarkdownFilesInDirectory(provider, termsDir);
      paths.push(...termFiles);
    }

    return [...new Set(paths)];
  } catch {
    return [];
  }
}

/**
 * Lists markdown files directly inside a directory (non-recursive).
 *
 * @param {import('../providers.js').Provider} provider - File provider
 * @param {string} dirPath - Directory relative to repo root
 * @returns {Promise<string[]>} Markdown file paths
 */
async function listMarkdownFilesInDirectory(provider, dirPath) {
  try {
    const dirExists = await provider.directoryExists(dirPath);
    if (!dirExists) {
      return [];
    }

    const entries = await provider.listFiles(dirPath);
    return entries
      .filter(
        entry =>
          entry.isFile &&
          (entry.name.endsWith('.md') || entry.name.endsWith('.markdown'))
      )
      .map(entry => entry.path || joinPath(dirPath, entry.name));
  } catch {
    return [];
  }
}

/**
 * Fallback discovery when specs.json is unavailable: shallow scan of common dirs.
 *
 * @param {import('../providers.js').Provider} provider - File provider
 * @returns {Promise<string[]>} Markdown file paths
 */
async function discoverMarkdownFilesFallback(provider) {
  const files = [];
  const searchPaths = ['spec/', 'specs/', 'docs/', ''];

  for (const searchPath of searchPaths) {
    try {
      const entries = await provider.listFiles(searchPath);
      const mdFiles = entries.filter(
        entry =>
          entry.isFile &&
          (entry.name.endsWith('.md') || entry.name.endsWith('.markdown'))
      );
      files.push(...mdFiles.map(entry => entry.path));
    } catch {
      // Directory missing or unreadable — continue
    }
  }

  return [...new Set(files)];
}

/**
 * Builds the human-readable result message for this check.
 *
 * @param {string[]} unresolved - Unresolved reference terms
 * @param {string[]} dangling - Dangling definition terms
 * @returns {string} Summary message
 */
function buildResultMessage(unresolved, dangling) {
  const parts = [];
  if (unresolved.length > 0) {
    parts.push(
      `${unresolved.length} unresolved reference${unresolved.length > 1 ? 's' : ''}`
    );
  }
  if (dangling.length > 0) {
    parts.push(
      `${dangling.length} dangling definition${dangling.length > 1 ? 's' : ''}`
    );
  }
  return `Found ${parts.join(' and ')}`;
}

/**
 * Builds warning strings matching the menu option 4 console report style.
 *
 * @param {string[]} unresolved - Unresolved reference terms
 * @param {string[]} dangling - Dangling definition terms
 * @returns {string[]} Warning messages for the HTML/CLI formatter
 */
function buildWarningMessages(unresolved, dangling) {
  const warnings = [];
  if (unresolved.length > 0) {
    warnings.push(`Unresolved References: ${unresolved.join(',')}`);
  }
  if (dangling.length > 0) {
    warnings.push(`Dangling Definitions: ${dangling.join(',')}`);
  }
  return warnings;
}

/**
 * Reads and parses markdown files in small parallel batches.
 *
 * Browser-based GitHub providers fetch each file via the GitHub Contents API,
 * so strictly sequential reads can exceed the per-check timeout on larger specs.
 * Batched reads keep the request count the same while reducing wall-clock time.
 *
 * @param {import('../providers.js').Provider} provider - Provider for file access
 * @param {string[]} markdownFiles - Paths to analyze
 * @param {number} [batchSize=8] - Number of concurrent reads per batch
 * @returns {Promise<{definitions: Array, references: string[], trefTerms: string[], filesChecked: number}>}
 */
async function collectTerminologyFromFiles(provider, markdownFiles, batchSize = 8) {
  const allDefinitions = [];
  const allReferences = [];
  const allTrefTerms = [];
  let filesChecked = 0;

  for (let i = 0; i < markdownFiles.length; i += batchSize) {
    const batch = markdownFiles.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async filePath => {
        try {
          const content = await provider.readFile(filePath);
          return extractTerminology(content);
        } catch {
          return null;
        }
      })
    );

    results.filter(Boolean).forEach(extracted => {
      allDefinitions.push(...extracted.definitions);
      allReferences.push(...extracted.references);
      allTrefTerms.push(...extracted.trefTerms);
      filesChecked += 1;
    });
  }

  return { allDefinitions, allReferences, allTrefTerms, filesChecked };
}

/**
 * Validates term references and definitions in specification markdown files.
 *
 * Reports the same Unresolved References and Dangling Definitions issues that
 * appear when running spec-up-t menu option 4, without requiring a render.
 *
 * @param {import('../providers.js').Provider} provider - Provider for file access
 * @returns {Promise<import('../health-check-utils.js').HealthCheckResult>} Check result
 *
 * @example
 * ```javascript
 * const provider = createLocalProvider('/path/to/repo');
 * const result = await checkTermReferences(provider);
 * console.log(result.status); // 'pass' or 'warn'
 * ```
 */
export async function checkTermReferences(provider) {
  try {
    const markdownFiles = await discoverMarkdownFiles(provider);

    if (markdownFiles.length === 0) {
      return createHealthCheckResult(
        CHECK_ID,
        'skip',
        'No specification markdown files found to check term references',
        { filesChecked: 0 }
      );
    }

    const {
      allDefinitions,
      allReferences,
      allTrefTerms,
      filesChecked
    } = await collectTerminologyFromFiles(provider, markdownFiles);

    const resolvableIds = buildResolvableTermIds(allDefinitions, allTrefTerms);
    const unresolvedReferences = findUnresolvedReferences(allReferences, resolvableIds);
    const danglingDefinitions = findDanglingDefinitions(allDefinitions, allReferences);

    const details = {
      filesChecked,
      referenceCount: allReferences.length,
      definitionCount: allDefinitions.length,
      trefCount: allTrefTerms.length,
      unresolvedReferences,
      danglingDefinitions,
      warnings: buildWarningMessages(unresolvedReferences, danglingDefinitions),
      hints: {
        unresolved:
          'Add [[def: term]] definitions or [[tref: repo, term]] transclusion, or fix typos in [[ref: term]]',
        dangling: 'Add [[ref: term]] references where needed, or remove unused definitions'
      }
    };

    if (unresolvedReferences.length === 0 && danglingDefinitions.length === 0) {
      return createHealthCheckResult(
        CHECK_ID,
        'pass',
        `All term references resolve (${allReferences.length} refs, ${allDefinitions.length} defs)`,
        details
      );
    }

    return createHealthCheckResult(
      CHECK_ID,
      'warn',
      buildResultMessage(unresolvedReferences, danglingDefinitions),
      details
    );
  } catch (error) {
    return createErrorResult(
      CHECK_ID,
      `Failed to validate term references: ${error.message}`,
      { error: error.message, stack: error.stack }
    );
  }
}
