/**
 * @fileoverview Term reference validation health check
 *
 * Mirrors the Unresolved References / Dangling Definitions reports produced
 * during spec-up-t menu option 4 (validateReferences against rendered HTML).
 *
 * Prefers the generated index.html under each spec's output_path. When that
 * file is missing from the repo (e.g. docs/ is gitignored), falls back to the
 * published GitHub Pages site derived from the GitHub provider path or from
 * specs.json source / gh_page. That matches how GitHubUi already opens the
 * live page and is much faster than fetching every markdown source file.
 *
 * Logic (aligned with validateReferences in spec-up-t):
 * - Unresolved: [[ref:]] / [[iref:]] terms with no matching id="term:…"
 * - Dangling: [[def:]] terms (or first alias) with no href="#term:…"
 *   (iref placeholders do not count as references for dangling checks)
 *
 * @author spec-up-t-healthcheck
 */

import axios from 'axios';
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
  'Detects unresolved references and dangling definitions in rendered index.html';

/**
 * Timeout for fetching a published GitHub Pages HTML document.
 * @type {number}
 */
const HTML_FETCH_TIMEOUT = 30000;

/**
 * Proxy URL for browser environments (to bypass CORS / CSP).
 * Assumes proxy.php is in the public root directory.
 * @type {string}
 */
const PROXY_URL = './proxy.php';

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
 * Detects if code is running in a browser environment.
 *
 * @returns {boolean} True if running in a browser
 */
function isBrowserEnvironment() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Ensures a published page URL ends with a trailing slash so GitHub Pages
 * serves index.html rather than a directory listing redirect edge case.
 *
 * @param {string} url - Raw page URL
 * @returns {string} Normalized URL
 */
function normalizePageUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) {
    return '';
  }
  if (/\.html?$/i.test(trimmed)) {
    return trimmed;
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/**
 * Builds the conventional GitHub Pages URL for an owner/repo pair.
 *
 * @param {string} owner - GitHub account or org
 * @param {string} repo - Repository name
 * @returns {string} Published page URL, or empty string if inputs are incomplete
 */
function buildGitHubPagesUrl(owner, repo) {
  if (!owner || !repo) {
    return '';
  }
  return `https://${owner}.github.io/${repo}/`;
}

/**
 * Finds index.html paths from specs.json output_path entries.
 * Falls back to common output locations when specs.json is missing.
 *
 * @param {import('../providers.js').Provider} provider - File provider
 * @returns {Promise<string[]>} Paths to index.html files
 */
async function discoverIndexHtmlFiles(provider) {
  const fromSpecs = await getIndexPathsFromSpecsJson(provider);
  if (fromSpecs.length > 0) {
    return fromSpecs;
  }
  return discoverIndexHtmlFallback(provider);
}

/**
 * Reads output_path from each spec in specs.json and returns index.html paths
 * that exist in the repository.
 *
 * @param {import('../providers.js').Provider} provider - File provider
 * @returns {Promise<string[]>} Existing index.html paths
 */
async function getIndexPathsFromSpecsJson(provider) {
  try {
    const exists = await provider.fileExists('specs.json');
    if (!exists) {
      return [];
    }

    const data = JSON.parse(await provider.readFile('specs.json'));
    const paths = [];

    for (const spec of data.specs || []) {
      if (!spec.output_path) {
        continue;
      }
      const indexPath = joinPath(spec.output_path, 'index.html');
      try {
        if (await provider.fileExists(indexPath)) {
          paths.push(indexPath);
        }
      } catch {
        // Skip unreadable paths
      }
    }

    return [...new Set(paths)];
  } catch {
    return [];
  }
}

/**
 * Fallback discovery when specs.json is unavailable.
 *
 * @param {import('../providers.js').Provider} provider - File provider
 * @returns {Promise<string[]>} Existing index.html paths
 */
async function discoverIndexHtmlFallback(provider) {
  const candidates = ['docs/index.html', 'output/index.html', 'index.html'];
  const found = [];

  for (const candidate of candidates) {
    try {
      if (await provider.fileExists(candidate)) {
        found.push(candidate);
      }
    } catch {
      // Continue
    }
  }

  return found;
}

/**
 * Derives published GitHub Pages URLs to try when local index.html is absent.
 *
 * Order of preference:
 * 1. GitHub provider repoPath (owner/repo/branch) — accurate for GitHubUi forks
 * 2. Top-level specs.json gh_page, if present
 * 3. specs.json source.account + source.repo
 *
 * @param {import('../providers.js').Provider} provider - File provider
 * @returns {Promise<string[]>} Candidate published page URLs
 */
export async function discoverPublishedPageUrls(provider) {
  const urls = [];

  if (provider.type === 'github' && provider.repoPath) {
    const [owner, repo] = String(provider.repoPath).split('/');
    const fromProvider = buildGitHubPagesUrl(owner, repo);
    if (fromProvider) {
      urls.push(fromProvider);
    }
  }

  try {
    const exists = await provider.fileExists('specs.json');
    if (exists) {
      const data = JSON.parse(await provider.readFile('specs.json'));
      for (const spec of data.specs || []) {
        if (typeof spec.gh_page === 'string' && spec.gh_page.trim()) {
          urls.push(normalizePageUrl(spec.gh_page));
        } else if (spec.source?.account && spec.source?.repo) {
          urls.push(buildGitHubPagesUrl(spec.source.account, spec.source.repo));
        }
      }
    }
  } catch {
    // specs.json unavailable — keep whatever we already have
  }

  return [...new Set(urls.filter(Boolean))];
}

/**
 * Returns true when a fetch response looks like a rendered Spec-Up-T page,
 * not a failed proxy (e.g. Vite serving proxy.php source as a static file).
 *
 * @param {unknown} data - Response body
 * @returns {boolean} Whether the body is usable HTML
 */
function isUsableHtml(data) {
  if (typeof data !== 'string' || !data.trim()) {
    return false;
  }
  const trimmed = data.trimStart();
  // Vite/dev serves public/proxy.php as a static file (HTTP 200 + PHP source)
  if (trimmed.startsWith('<?php')) {
    return false;
  }
  return /<html[\s>]|<body[\s>]|terms-and-definitions|term-reference|term-local/i.test(
    data
  );
}

/**
 * Fetches HTML from a published page URL.
 *
 * In the browser, tries proxy.php first (production CORS bypass), then falls
 * back to a direct request. GitHub Pages sends Access-Control-Allow-Origin: *,
 * so direct fetch works once CSP allows https://*.github.io.
 * In Node.js, axios fetches the URL directly.
 *
 * @param {string} url - Published page URL
 * @returns {Promise<string>} HTML document text
 */
export async function fetchPublishedHtml(url) {
  const target = normalizePageUrl(url);
  if (!target) {
    throw new Error('Published page URL is empty');
  }

  const requestOptions = {
    timeout: HTML_FETCH_TIMEOUT,
    maxRedirects: 5,
    // Keep HTML as raw text (do not JSON-parse)
    transformResponse: [data => data],
    validateStatus: status => status >= 200 && status < 400
  };

  if (isBrowserEnvironment()) {
    try {
      const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(target)}`;
      const proxied = await axios.get(proxyUrl, requestOptions);
      if (isUsableHtml(proxied.data)) {
        return proxied.data;
      }
    } catch {
      // Proxy missing (Vite/dev) or unreachable — try direct fetch
    }

    const direct = await axios.get(target, requestOptions);
    if (!isUsableHtml(direct.data)) {
      throw new Error(`Published page did not return usable HTML: ${target}`);
    }
    return direct.data;
  }

  const response = await axios.get(target, requestOptions);
  if (!isUsableHtml(response.data)) {
    throw new Error(`Published page did not return usable HTML: ${target}`);
  }
  return response.data;
}

/**
 * Resolves HTML sources: local index.html files first, otherwise published pages.
 *
 * @param {import('../providers.js').Provider} provider - File provider
 * @returns {Promise<Array<{type: 'file', path: string}|{type: 'url', url: string}>>}
 */
async function discoverHtmlSources(provider) {
  const indexFiles = await discoverIndexHtmlFiles(provider);
  if (indexFiles.length > 0) {
    return indexFiles.map(path => ({ type: 'file', path }));
  }

  const pageUrls = await discoverPublishedPageUrls(provider);
  return pageUrls.map(url => ({ type: 'url', url }));
}

/**
 * Loads HTML for one discovered source (local file or published URL).
 *
 * @param {import('../providers.js').Provider} provider - File provider
 * @param {{type: 'file', path: string}|{type: 'url', url: string}} source - Source descriptor
 * @returns {Promise<{html: string, label: string, origin: 'file'|'url'}>}
 */
async function loadHtmlSource(provider, source) {
  if (source.type === 'file') {
    const html = await provider.readFile(source.path);
    return { html, label: source.path, origin: 'file' };
  }
  const html = await fetchPublishedHtml(source.url);
  return { html, label: source.url, origin: 'url' };
}

/**
 * Primary term of a local definition, rendered by parseDef.
 * @type {RegExp}
 */
const ORIGINAL_TERM_REGEX = /term-local-original-term[^>]*>([^<]+)</i;

/**
 * Marks a definition that carries aliases.
 * @type {RegExp}
 */
const PARENTHETICAL_TERMS_REGEX = /term-local-parenthetical-terms/i;

/**
 * First alias of a local definition (the display term before the parentheses).
 * @type {RegExp}
 */
const ALIAS_REGEX = />([^<]+)\s*<span[^>]*term-local-parenthetical-terms/i;

/**
 * Class marker on an anchor produced by parseRef.
 * @type {RegExp}
 */
const TERM_REFERENCE_CLASS_REGEX = /\bterm-reference\b/;

/**
 * Class marker on an anchor produced by parseXref. Those anchors also carry
 * term-reference, but xrefs point at other specs and spec-up-t never records
 * them as local references, so they must not be reported as unresolved.
 * @type {RegExp}
 */
const XREF_CLASS_REGEX = /\bx-term-reference\b/;

/**
 * Local term href produced by parseRef. The leading boundary keeps this from
 * matching data-local-href, which xref anchors use for their fallback target.
 * @type {RegExp}
 */
const TERM_HREF_REGEX = /(?:^|[\s"';])href\s*=\s*["']#term:/i;

/**
 * Class marker on a placeholder produced by parseIref.
 * @type {RegExp}
 */
const IREF_CLASS_REGEX = /\biref-placeholder\b/;

/**
 * Original spelling of an inline reference, kept by parseIref.
 * @type {RegExp}
 */
const IREF_ORIGINAL_REGEX = /data-iref-original\s*=\s*["']([^"']+)["']/i;

/**
 * Extracts local definitions from rendered glossary HTML.
 *
 * Local defs live in <dt class="term-local"> with:
 * - primary term in span.term-local-original-term
 * - first alias as the display text before term-local-parenthetical-terms
 *   (when aliases exist)
 *
 * @param {string} html - Rendered index.html content
 * @returns {Array<{term: string, alias: string|null}>} Local definitions
 */
export function extractDefinitionsFromHtml(html) {
  const definitions = [];
  const dtRegex = /<dt\b[^>]*\bterm-local\b[^>]*>([\s\S]*?)<\/dt>/gi;
  let match;

  while ((match = dtRegex.exec(html)) !== null) {
    const dtContent = match[1];
    const originalMatch = ORIGINAL_TERM_REGEX.exec(dtContent);
    if (!originalMatch) {
      continue;
    }

    const term = originalMatch[1].trim();
    if (!term) {
      continue;
    }

    let alias = null;
    if (PARENTHETICAL_TERMS_REGEX.test(dtContent)) {
      const aliasMatch = ALIAS_REGEX.exec(dtContent);
      const candidate = aliasMatch?.[1].trim();
      if (candidate) {
        alias = candidate;
      }
    }

    definitions.push({ term, alias });
  }

  return definitions;
}

/**
 * Extracts reference terms from rendered HTML.
 *
 * Collects:
 * - Text of <a class="term-reference" href="#term:…"> (from [[ref:]])
 * - data-iref-original on span.iref-placeholder (from [[iref:]])
 *
 * Anchors from [[xref:]] are skipped: they target other specifications and
 * spec-up-t does not track them as local references.
 *
 * @param {string} html - Rendered index.html content
 * @returns {string[]} Raw reference terms (may contain duplicates)
 */
export function extractReferencesFromHtml(html) {
  const references = [];

  const anchorRegex = /<a\b([^>]*)>([^<]*)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const attrs = match[1];
    if (!TERM_REFERENCE_CLASS_REGEX.test(attrs) || XREF_CLASS_REGEX.test(attrs)) {
      continue;
    }
    if (!TERM_HREF_REGEX.test(attrs)) {
      continue;
    }
    const text = match[2].trim();
    if (text) {
      references.push(text);
    }
  }

  const spanRegex = /<span\b([^>]*)>/gi;
  while ((match = spanRegex.exec(html)) !== null) {
    const attrs = match[1];
    if (!IREF_CLASS_REGEX.test(attrs)) {
      continue;
    }
    const original = IREF_ORIGINAL_REGEX.exec(attrs)?.[1].trim();
    if (original) {
      references.push(original);
    }
  }

  return references;
}

/**
 * Finds references that have no matching term id in the HTML.
 * Matches validateReferences: render.includes(`id="term:${normalized}"`).
 *
 * @param {string[]} references - Raw reference terms
 * @param {string} html - Rendered HTML
 * @returns {string[]} Unresolved reference terms (original spelling, unique)
 */
export function findUnresolvedReferences(references, html) {
  const unresolved = [];
  for (const ref of new Set(references)) {
    const needle = `id="term:${normalizeTerm(ref)}"`;
    if (!html.includes(needle)) {
      unresolved.push(ref);
    }
  }
  return unresolved;
}

/**
 * Finds definitions that are never referenced via href="#term:…".
 * Matches validateReferences: only term + first alias; irefs do not count.
 *
 * @param {Array<{term: string, alias: string|null}>} definitions - Local definitions
 * @param {string} html - Rendered HTML
 * @returns {string[]} Primary terms of dangling definitions
 */
export function findDanglingDefinitions(definitions, html) {
  const dangling = [];

  for (const def of definitions) {
    const candidates = [def.term, def.alias].filter(Boolean);
    const isReferenced = candidates.some(term =>
      html.includes(`href="#term:${normalizeTerm(term)}"`)
    );
    if (!isReferenced) {
      dangling.push(def.term);
    }
  }

  return [...new Set(dangling)];
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
 * Analyzes one rendered index.html for unresolved refs and dangling defs.
 *
 * @param {string} html - File contents
 * @returns {{definitions: Array, references: string[], unresolvedReferences: string[], danglingDefinitions: string[]}}
 */
export function analyzeRenderedHtml(html) {
  const definitions = extractDefinitionsFromHtml(html);
  const references = extractReferencesFromHtml(html);
  const unresolvedReferences = findUnresolvedReferences(references, html);
  const danglingDefinitions = findDanglingDefinitions(definitions, html);

  return {
    definitions,
    references,
    unresolvedReferences,
    danglingDefinitions
  };
}

/**
 * Validates term references and definitions in rendered index.html output.
 *
 * Prefers local output_path/index.html. When that file is not in the repo,
 * falls back to the published GitHub Pages site.
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
    const sources = await discoverHtmlSources(provider);

    if (sources.length === 0) {
      return createHealthCheckResult(
        CHECK_ID,
        'skip',
        'No rendered index.html or published GitHub Pages URL found to check term references',
        {
          filesChecked: 0,
          suggestions: [
            'Run "npm run render" or "npm run dev" to generate index.html',
            'Commit docs/index.html, or publish GitHub Pages so the live site can be used as a fallback',
            'Ensure specs.json has source.account and source.repo (used to derive https://{account}.github.io/{repo}/)'
          ]
        }
      );
    }

    const allDefinitions = [];
    const allReferences = [];
    const unresolvedReferences = [];
    const danglingDefinitions = [];
    const sourcesChecked = [];
    const fetchErrors = [];
    let filesChecked = 0;

    for (const source of sources) {
      try {
        const loaded = await loadHtmlSource(provider, source);
        const analyzed = analyzeRenderedHtml(loaded.html);
        allDefinitions.push(...analyzed.definitions);
        allReferences.push(...analyzed.references);
        unresolvedReferences.push(...analyzed.unresolvedReferences);
        danglingDefinitions.push(...analyzed.danglingDefinitions);
        sourcesChecked.push({ label: loaded.label, origin: loaded.origin });
        filesChecked += 1;
        // One successful HTML document is enough; prefer local, then first working page
        break;
      } catch (error) {
        fetchErrors.push({
          source: source.type === 'file' ? source.path : source.url,
          error: error.message
        });
      }
    }

    if (filesChecked === 0) {
      return createHealthCheckResult(
        CHECK_ID,
        'skip',
        'Could not read local index.html or fetch a published GitHub Pages site',
        {
          filesChecked: 0,
          attemptedSources: sources.map(s => (s.type === 'file' ? s.path : s.url)),
          fetchErrors,
          suggestions: [
            'Run "npm run render" to generate index.html locally',
            'Verify the GitHub Pages site is published and reachable',
            'In the browser, ensure proxy.php is available for CORS'
          ]
        }
      );
    }

    const uniqueUnresolved = [...new Set(unresolvedReferences)];
    const uniqueDangling = [...new Set(danglingDefinitions)];
    const usedPublishedPage = sourcesChecked.some(s => s.origin === 'url');

    const details = {
      filesChecked,
      indexFiles: sourcesChecked.filter(s => s.origin === 'file').map(s => s.label),
      publishedPages: sourcesChecked.filter(s => s.origin === 'url').map(s => s.label),
      sourceOrigin: usedPublishedPage ? 'published-page' : 'local-file',
      referenceCount: allReferences.length,
      definitionCount: allDefinitions.length,
      unresolvedReferences: uniqueUnresolved,
      danglingDefinitions: uniqueDangling,
      warnings: buildWarningMessages(uniqueUnresolved, uniqueDangling),
      hints: {
        unresolved:
          'Add [[def: term]] definitions or [[tref: repo, term]] transclusion, or fix typos in [[ref: term]]',
        dangling: 'Add [[ref: term]] references where needed, or remove unused definitions'
      }
    };

    if (fetchErrors.length > 0) {
      details.fetchErrors = fetchErrors;
    }

    const sourceNote = usedPublishedPage
      ? ` (from published page ${sourcesChecked[0].label})`
      : '';

    if (uniqueUnresolved.length === 0 && uniqueDangling.length === 0) {
      return createHealthCheckResult(
        CHECK_ID,
        'pass',
        `All term references resolve (${allReferences.length} refs, ${allDefinitions.length} defs)${sourceNote}`,
        details
      );
    }

    return createHealthCheckResult(
      CHECK_ID,
      'warn',
      `${buildResultMessage(uniqueUnresolved, uniqueDangling)}${sourceNote}`,
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
