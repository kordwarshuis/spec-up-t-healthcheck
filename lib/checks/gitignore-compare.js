/**
 * @fileoverview Pure .gitignore comparison helpers for Spec-Up-T health checks.
 *
 * These functions are environment-agnostic (Node.js and browser). They parse
 * gitignore text, normalize patterns for fuzzy equivalence, and compare a
 * project .gitignore (File A) against a Spec-Up-T reference (File B).
 *
 * Kept as a separate module so the check wrapper stays thin and the comparison
 * logic can be unit-tested without providers or network access.
 *
 * @author spec-up-t-healthcheck
 */

/**
 * Patterns that must never appear in a .gitignore because they would prevent
 * important Spec-Up-T files from being tracked.
 *
 * @type {readonly {pattern: string, reason: string}[]}
 */
export const SHOULD_NOT_IGNORE = Object.freeze([
  {
    pattern: 'package.json',
    reason: '`package.json` must be committed to version control to ensure reproducible installs. Remove this line from your .gitignore.'
  },
  {
    pattern: 'package-lock.json',
    reason: '`package-lock.json` must be committed to version control to ensure reproducible installs. Remove this line from your .gitignore.'
  },
  {
    pattern: 'specs.json',
    reason: '`specs.json` must be committed to version control. Remove this line from your .gitignore.'
  },
  {
    pattern: 'spec',
    reason: '`spec` must be committed to version control to ensure Spec-Up-T works. Remove this line from your .gitignore.'
  },
  {
    pattern: 'spec/',
    reason: '`spec/` must be committed to version control to ensure Spec-Up-T works. Remove this line from your .gitignore.'
  }
]);

/**
 * Produce a normalized form of a gitignore pattern for fuzzy equivalence.
 * Strips negation markers, leading/trailing slashes, and recursive glob
 * prefixes, then lowercases.
 *
 * @param {string} pattern - Raw pattern string
 * @returns {string} Normalized pattern
 */
export function normalizePattern(pattern) {
  let normalized = pattern;
  if (normalized.startsWith('!')) normalized = normalized.slice(1);
  if (normalized.startsWith('/')) normalized = normalized.slice(1);
  if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  normalized = normalized.replace(/^\*\*\//, '');
  return normalized.toLowerCase();
}

/**
 * True when two patterns are identical strings.
 *
 * @param {string} a - First pattern
 * @param {string} b - Second pattern
 * @returns {boolean}
 */
export function isExactMatch(a, b) {
  return a === b;
}

/**
 * True when two patterns normalize to the same string but are not identical.
 *
 * @param {string} a - First pattern
 * @param {string} b - Second pattern
 * @returns {boolean}
 */
export function isFuzzyMatch(a, b) {
  return !isExactMatch(a, b) && normalizePattern(a) === normalizePattern(b);
}

/**
 * True when a trimmed line is a pure comment / section heading.
 *
 * @param {string} trimmedLine - Trimmed line content
 * @returns {boolean}
 */
export function isSectionHeading(trimmedLine) {
  return trimmedLine.startsWith('#');
}

/**
 * Strip an inline comment from a pattern line.
 * Inline comments start with an unescaped ' #' (space then hash).
 *
 * @param {string} line - Pattern line that may contain an inline comment
 * @returns {{pattern: string, inlineComment: string|null}}
 */
export function stripInlineComment(line) {
  const match = line.match(/(?<!\\)\s#\s*(.*)/);
  if (match) {
    return {
      pattern: line.slice(0, match.index).trim(),
      inlineComment: match[1].trim()
    };
  }
  return { pattern: line.trim(), inlineComment: null };
}

/**
 * Parse raw gitignore text into structured entry objects.
 *
 * @param {string} rawContent - Full .gitignore file contents
 * @returns {Array<{lineNumber: number, raw: string, type: string, section: string|null, pattern: string|null, inlineComment: string|null, isNegation: boolean}>}
 */
export function parseGitignore(rawContent) {
  const lines = rawContent.split(/\r?\n/);
  const entries = [];
  let currentSection = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (trimmed === '') {
      entries.push({
        lineNumber: i + 1,
        raw,
        type: 'blank',
        section: currentSection,
        pattern: null,
        inlineComment: null,
        isNegation: false
      });
      continue;
    }

    if (isSectionHeading(trimmed)) {
      const commentText = trimmed.replace(/^#+\s*/, '').trim();
      currentSection = commentText || currentSection;
      entries.push({
        lineNumber: i + 1,
        raw,
        type: 'comment',
        section: currentSection,
        pattern: null,
        inlineComment: null,
        isNegation: false
      });
      continue;
    }

    const { pattern, inlineComment } = stripInlineComment(trimmed);
    entries.push({
      lineNumber: i + 1,
      raw,
      type: 'pattern',
      section: currentSection,
      pattern,
      inlineComment,
      isNegation: pattern.startsWith('!')
    });
  }

  return entries;
}

/**
 * Return only pattern entries from a parsed entry array.
 *
 * @param {Array<{type: string}>} entries - Parsed gitignore entries
 * @returns {Array}
 */
export function extractPatterns(entries) {
  return entries.filter(entry => entry.type === 'pattern');
}

/**
 * Scan File A patterns for known forbidden patterns.
 *
 * @param {Array<{pattern: string, lineNumber: number, isNegation: boolean}>} patternsA - Patterns from the project file
 * @returns {Array<{pattern: string, lineA: number, reason: string}>}
 */
export function findDangerousPatterns(patternsA) {
  return SHOULD_NOT_IGNORE.reduce((acc, { pattern, reason }) => {
    const match = patternsA.find(
      entry => !entry.isNegation && isExactMatch(entry.pattern, pattern)
    );
    if (match) {
      acc.push({ pattern, lineA: match.lineNumber, reason });
    }
    return acc;
  }, []);
}

/**
 * Find patterns in File A that appear more than once (exact or fuzzy).
 *
 * @param {Array<{pattern: string, lineNumber: number}>} patternsA - Patterns from the project file
 * @returns {Array<{normalized: string, kind: string, patterns: string[], lines: number[]}>}
 */
export function findDuplicatePatterns(patternsA) {
  const groups = {};
  patternsA.forEach(entry => {
    const norm = normalizePattern(entry.pattern);
    if (!groups[norm]) groups[norm] = [];
    groups[norm].push(entry);
  });

  return Object.entries(groups).reduce((acc, [norm, groupEntries]) => {
    if (groupEntries.length < 2) return acc;
    const allExact = groupEntries.every(e => e.pattern === groupEntries[0].pattern);
    acc.push({
      normalized: norm,
      kind: allExact ? 'exact' : 'fuzzy',
      patterns: groupEntries.map(e => e.pattern),
      lines: groupEntries.map(e => e.lineNumber)
    });
    return acc;
  }, []);
}

/**
 * Build a short note explaining why two patterns are fuzzy-equivalent.
 *
 * @param {string} patternA - Pattern from the project file
 * @param {string} patternB - Pattern from the reference file
 * @returns {string}
 */
export function buildFuzzyNote(patternA, patternB) {
  const notes = [];
  if (patternA.replace(/\/$/, '') === patternB.replace(/\/$/, '')) {
    notes.push('trailing slash difference');
  }
  if (patternA.replace(/^\//, '') === patternB.replace(/^\//, '')) {
    notes.push('leading slash (anchor) difference');
  }
  if (patternA.toLowerCase() === patternB.toLowerCase() && patternA !== patternB) {
    notes.push('case difference');
  }
  if (
    patternA.replace(/^\*\*\//, '') === patternB ||
    patternB.replace(/^\*\*\//, '') === patternA
  ) {
    notes.push('recursive glob prefix difference (**/...)');
  }
  return notes.length > 0 ? notes.join('; ') : 'normalized form matches';
}

/**
 * Compare project .gitignore content (A) against reference content (B).
 *
 * @param {string} contentA - Project .gitignore contents
 * @param {string} contentB - Spec-Up-T reference .gitignore contents
 * @returns {Object} Structured comparison result
 */
export function compareGitignore(contentA, contentB) {
  const patternsA = extractPatterns(parseGitignore(contentA));
  const patternsB = extractPatterns(parseGitignore(contentB));

  const presentExact = [];
  const presentFuzzy = [];
  const missing = [];
  const matchedAIndices = new Set();

  for (const entryB of patternsB) {
    const exactIndex = patternsA.findIndex(
      (entryA, i) => !matchedAIndices.has(i) && isExactMatch(entryA.pattern, entryB.pattern)
    );

    if (exactIndex !== -1) {
      presentExact.push({
        patternB: entryB.pattern,
        patternA: patternsA[exactIndex].pattern,
        sectionB: entryB.section,
        lineA: patternsA[exactIndex].lineNumber,
        lineB: entryB.lineNumber
      });
      matchedAIndices.add(exactIndex);
      continue;
    }

    const fuzzyIndex = patternsA.findIndex(
      (entryA, i) => !matchedAIndices.has(i) && isFuzzyMatch(entryA.pattern, entryB.pattern)
    );

    if (fuzzyIndex !== -1) {
      presentFuzzy.push({
        patternB: entryB.pattern,
        patternA: patternsA[fuzzyIndex].pattern,
        sectionB: entryB.section,
        lineA: patternsA[fuzzyIndex].lineNumber,
        lineB: entryB.lineNumber,
        note: buildFuzzyNote(patternsA[fuzzyIndex].pattern, entryB.pattern)
      });
      matchedAIndices.add(fuzzyIndex);
      continue;
    }

    missing.push({
      patternB: entryB.pattern,
      sectionB: entryB.section,
      lineB: entryB.lineNumber
    });
  }

  const extra = patternsA
    .filter((_, i) => !matchedAIndices.has(i))
    .map(entry => ({
      patternA: entry.pattern,
      sectionA: entry.section,
      lineA: entry.lineNumber
    }));

  const summary = {
    totalInB: patternsB.length,
    totalInA: patternsA.length,
    exactMatches: presentExact.length,
    fuzzyMatches: presentFuzzy.length,
    missingCount: missing.length,
    extraCount: extra.length,
    compliancePercent:
      patternsB.length === 0
        ? 100
        : Math.round(((presentExact.length + presentFuzzy.length) / patternsB.length) * 100)
  };

  return {
    summary,
    presentExact,
    presentFuzzy,
    missing,
    extra,
    warnings: findDangerousPatterns(patternsA),
    duplicates: findDuplicatePatterns(patternsA)
  };
}
