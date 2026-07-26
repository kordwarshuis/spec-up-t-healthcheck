/**
 * @fileoverview Markdown table validation health check module
 * 
 * This module validates markdown tables in specification files, checking for:
 * - Proper table structure (header, separator, body rows)
 * - Consistent column counts across all rows
 * - Valid separator line syntax
 * - Problematic characters that can break table parsing
 * - Mismatched quotes or backticks in table cells
 * 
 * This validator catches errors that can cause issues with markdown-it-attrs
 * and other markdown table parsing plugins.
 * 
 * @author spec-up-t-healthcheck
 */

import { createHealthCheckResult, createErrorResult } from '../health-check-utils.js';

/**
 * The identifier for this health check, used in reports and registries.
 * @type {string}
 */
export const CHECK_ID = 'markdown-tables';

/**
 * Human-readable name for this health check.
 * @type {string}
 */
export const CHECK_NAME = 'Markdown Table Validation';

/**
 * Description of what this health check validates.
 * @type {string}
 */
export const CHECK_DESCRIPTION = 'Validates markdown table structure and syntax';

/**
 * Represents a table found in a markdown file.
 * @typedef {Object} TableInfo
 * @property {string} file - Path to the file containing the table
 * @property {number} startLine - Line number where the table starts
 * @property {number} endLine - Line number where the table ends
 * @property {string[]} content - Array of table lines
 * @property {number} headerColumns - Number of columns in header
 * @property {number} separatorColumns - Number of columns in separator
 * @property {boolean} hasSeparator - Whether table has a separator line
 * @property {boolean} columnMismatch - Whether column counts don't match
 * @property {Object[]} issues - Array of specific issues found
 */

/**
 * Extracts all tables from markdown content.
 * 
 * This function parses markdown content line by line and identifies table structures.
 * Tables are detected by lines containing pipe characters (|).
 * 
 * @param {string} content - The markdown content to parse
 * @param {string} filePath - Path to the file (for error reporting)
 * @returns {TableInfo[]} Array of table information objects
 */
function extractTables(content, filePath) {
  const lines = content.split('\n');
  const tables = [];
  let inTable = false;
  let tableStartLine = 0;
  let tableContent = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Detect table start (line with pipes)
    if (trimmedLine.match(/^\|.*\|/)) {
      if (!inTable) {
        inTable = true;
        tableStartLine = i + 1; // 1-indexed for user display
        tableContent = [];
      }
      tableContent.push({ lineNum: i + 1, content: line });
    } else if (inTable && (trimmedLine === '' || !line.includes('|'))) {
      // Table ended - analyze and store it
      if (tableContent.length > 0) {
        const tableInfo = analyzeTable(tableContent, tableStartLine, filePath);
        tables.push(tableInfo);
      }
      inTable = false;
    } else if (inTable && line.includes('|')) {
      // Continuation of table (might be in code block or other context)
      tableContent.push({ lineNum: i + 1, content: line });
    }
  }

  // Handle table at end of file
  if (inTable && tableContent.length > 0) {
    const tableInfo = analyzeTable(tableContent, tableStartLine, filePath);
    tables.push(tableInfo);
  }

  return tables;
}

/**
 * Analyzes a single table for structural issues.
 * 
 * This function performs comprehensive validation of table structure:
 * - Counts columns in each row
 * - Validates separator line format
 * - Checks for problematic characters
 * - Detects mismatched quotes and backticks
 * 
 * @param {Array<{lineNum: number, content: string}>} tableLines - Array of table lines
 * @param {number} startLine - Starting line number
 * @param {string} filePath - Path to the file
 * @returns {TableInfo} Analyzed table information
 */
function analyzeTable(tableLines, startLine, filePath) {
  const issues = [];
  
  // Extract header and separator
  const headerLine = tableLines[0];
  const separatorLine = tableLines.length > 1 ? tableLines[1] : null;
  
  // Count columns
  const headerColumns = countColumns(headerLine.content);
  const separatorColumns = separatorLine ? countColumns(separatorLine.content) : 0;
  const hasSeparator = separatorLine && isSeparatorLine(separatorLine.content);
  const columnMismatch = hasSeparator && (headerColumns !== separatorColumns);

  // Check each row for issues
  tableLines.forEach((line, idx) => {
    const rowIssues = validateTableRow(line.content, line.lineNum, idx === 1);
    issues.push(...rowIssues);
  });

  // Validate separator line specifically
  if (separatorLine && !hasSeparator) {
    issues.push({
      type: 'missing-separator',
      line: separatorLine.lineNum,
      message: 'Table separator line is missing or malformed (should contain only |, -, and :)',
      content: separatorLine.content
    });
  }

  // Check for column count mismatches
  if (columnMismatch) {
    issues.push({
      type: 'column-mismatch',
      line: startLine,
      message: `Column count mismatch: header has ${headerColumns} columns, separator has ${separatorColumns}`,
      content: `Header: ${headerLine.content}\nSeparator: ${separatorLine.content}`
    });
  }

  // Validate body row column counts
  if (hasSeparator && tableLines.length > 2) {
    const expectedColumns = headerColumns;
    for (let i = 2; i < tableLines.length; i++) {
      const rowColumns = countColumns(tableLines[i].content);
      if (rowColumns !== expectedColumns) {
        issues.push({
          type: 'row-column-mismatch',
          line: tableLines[i].lineNum,
          message: `Row has ${rowColumns} columns, expected ${expectedColumns}`,
          content: tableLines[i].content
        });
      }
    }
  }

  return {
    file: filePath,
    startLine,
    endLine: tableLines[tableLines.length - 1].lineNum,
    content: tableLines.map(l => l.content),
    headerColumns,
    separatorColumns,
    hasSeparator,
    columnMismatch,
    issues
  };
}

/**
 * Counts the number of columns in a table row.
 * 
 * Columns are delimited by pipe characters (|). The count excludes
 * leading and trailing pipes.
 * 
 * @param {string} line - The table row line
 * @returns {number} Number of columns
 */
function countColumns(line) {
  // Remove leading/trailing whitespace and pipes
  const trimmed = line.trim();
  if (!trimmed) return 0;
  
  // Count pipe separators (excluding leading/trailing)
  const withoutEnds = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const pipes = (withoutEnds.match(/\|/g) || []).length;
  
  return pipes + 1;
}

/**
 * Checks if a line is a valid table separator.
 * 
 * A valid separator line contains only pipes, hyphens, colons, and whitespace.
 * Format: |:---:|:---:| or |---|---| etc.
 * 
 * @param {string} line - The line to check
 * @returns {boolean} True if the line is a valid separator
 */
function isSeparatorLine(line) {
  const trimmed = line.trim();
  // Valid separator contains only: |, -, :, and whitespace
  return /^[\s|:\-]+$/.test(trimmed) && trimmed.includes('-');
}

/**
 * Validates a single table row for common issues.
 * 
 * This function checks for:
 * - Mismatched quotes (opening quote without closing)
 * - Mismatched backticks
 * - Problematic character combinations
 * - Extra quotes inside code spans
 * 
 * @param {string} line - The table row line
 * @param {number} lineNum - Line number in file
 * @param {boolean} isSeparator - Whether this is the separator row
 * @returns {Array<Object>} Array of issues found
 */
function validateTableRow(line, lineNum, isSeparator) {
  const issues = [];
  
  // Skip validation for separator lines
  if (isSeparator) {
    return issues;
  }

  // Split line into cells
  const cells = line.split('|').slice(1, -1); // Remove first/last empty elements
  
  cells.forEach((cell, cellIdx) => {
    const trimmedCell = cell.trim();
    
    // Check for problematic quote patterns in code spans
    // Pattern: `'text or `text'
    const backtickQuotePattern = /`['"]|['"]`/g;
    const backtickWithQuote = trimmedCell.match(backtickQuotePattern);
    if (backtickWithQuote) {
      issues.push({
        type: 'quote-in-code',
        line: lineNum,
        cell: cellIdx + 1,
        message: `Cell ${cellIdx + 1} contains potentially problematic quote/backtick combination: ${backtickWithQuote.join(', ')}`,
        content: cell,
        severity: 'warning'
      });
    }

    // Check for mismatched backticks in cell
    const backticks = (trimmedCell.match(/`/g) || []).length;
    if (backticks % 2 !== 0) {
      issues.push({
        type: 'mismatched-backticks',
        line: lineNum,
        cell: cellIdx + 1,
        message: `Cell ${cellIdx + 1} has mismatched backticks`,
        content: cell,
        severity: 'error'
      });
    }

    // Check for quote patterns that might indicate typos
    // Pattern: opening quote at start of backtick span
    const codeSpanStartQuote = /`'[^'`]*'?`/g;
    const matches = trimmedCell.match(codeSpanStartQuote);
    if (matches) {
      // Check if any match has quotes both at start AND end inside backticks
      matches.forEach(match => {
        if (match.match(/`'.*'`/)) {
          // This is likely intentional (quoted string in code)
          return;
        }
        // Only opening quote inside backticks - likely error
        if (match.match(/`'[^']*`$/)) {
          issues.push({
            type: 'likely-typo',
            line: lineNum,
            cell: cellIdx + 1,
            message: `Cell ${cellIdx + 1} has likely typo: opening quote inside backticks without matching closing quote`,
            content: cell,
            example: match,
            severity: 'error'
          });
        }
      });
    }

    // Check for attributes syntax {...} which requires careful table structure
    if (trimmedCell.includes('{') && trimmedCell.includes('}')) {
      const hasAttributes = /\{[.#][^\}]+\}/.test(trimmedCell);
      if (hasAttributes) {
        issues.push({
          type: 'has-attributes',
          line: lineNum,
          cell: cellIdx + 1,
          message: `Cell ${cellIdx + 1} contains attribute syntax {.class} or {#id} - ensure table structure is correct`,
          content: cell,
          severity: 'info'
        });
      }
    }
  });

  return issues;
}

/**
 * Checks markdown tables in specification files.
 * 
 * This health check validates all markdown tables found in specification files,
 * ensuring proper structure and catching common errors that can cause parsing issues.
 * 
 * The check performs the following validations:
 * - Table header and separator presence
 * - Consistent column counts across rows
 * - Valid separator line syntax
 * - Detection of problematic characters
 * - Validation of quotes and backticks in cells
 * 
 * @param {import('../providers.js').Provider} provider - The provider instance for file operations
 * @returns {Promise<import('../health-check-utils.js').HealthCheckResult>} The health check result
 * 
 * @example
 * ```javascript
 * const provider = createLocalProvider('/path/to/repo');
 * const result = await checkMarkdownTables(provider);
 * console.log(result.status); // 'pass', 'warning', or 'error'
 * ```
 */
export async function checkMarkdownTables(provider) {
  try {
    // Discover specification files
    const specFiles = await discoverSpecificationFiles(provider);
    
    if (specFiles.length === 0) {
      return createHealthCheckResult(
        CHECK_ID,
        'warn',
        'No specification files found to validate tables',
        {
          filesChecked: 0,
          tablesFound: 0,
          tablesWithIssues: 0
        }
      );
    }

    let totalTables = 0;
    let tablesWithIssues = 0;
    let totalIssues = 0;
    const fileResults = [];

    // Check each file for tables
    for (const filePath of specFiles) {
      try {
        const content = await provider.readFile(filePath);
        const tables = extractTables(content, filePath);
        
        totalTables += tables.length;

        // Analyze tables for issues
        const tablesWithProblems = tables.filter(t => t.issues.length > 0);
        tablesWithIssues += tablesWithProblems.length;
        totalIssues += tablesWithProblems.reduce((sum, t) => sum + t.issues.length, 0);

        if (tablesWithProblems.length > 0) {
          fileResults.push({
            file: filePath,
            tablesCount: tables.length,
            tablesWithIssues: tablesWithProblems.length,
            tables: tablesWithProblems
          });
        }
      } catch (error) {
        console.warn(`Could not read file ${filePath}:`, error.message);
      }
    }

    // Determine status
    let status = 'pass';
    let message = `All ${totalTables} tables are valid`;

    if (tablesWithIssues > 0) {
      // Check if any issues are errors vs warnings
      const hasErrors = fileResults.some(fr => 
        fr.tables.some(t => 
          t.issues.some(i => i.severity === 'error' || i.type === 'column-mismatch' || i.type === 'row-column-mismatch' || i.type === 'missing-separator')
        )
      );

      status = hasErrors ? 'fail' : 'warn';
      message = `Found ${totalIssues} issue(s) in ${tablesWithIssues} of ${totalTables} tables`;
    }

    return createHealthCheckResult(
      CHECK_ID,
      status,
      message,
      {
        filesChecked: specFiles.length,
        tablesFound: totalTables,
        tablesWithIssues,
        totalIssues,
        details: fileResults
      }
    );

  } catch (error) {
    return createErrorResult(
      CHECK_ID,
      `Failed to validate markdown tables: ${error.message}`,
      { error: error.message, stack: error.stack }
    );
  }
}

/**
 * Discovers specification files to check for tables.
 * 
 * This function searches for markdown files in common spec directories
 * and the repository root.
 * 
 * @param {import('../providers.js').Provider} provider - The provider instance
 * @returns {Promise<string[]>} Array of file paths to check
 * @private
 */
async function discoverSpecificationFiles(provider) {
  const files = [];
  const searchPaths = ['spec/', 'specs/', 'docs/', ''];

  for (const searchPath of searchPaths) {
    try {
      const entries = await provider.listFiles(searchPath);
      
      // Filter for markdown files only (not subdirectories)
      const mdFiles = entries.filter(entry => 
        entry.isFile && 
        (entry.name.endsWith('.md') || entry.name.endsWith('.markdown'))
      );
      
      // Use the full path from the entry
      files.push(...mdFiles.map(entry => entry.path));
    } catch (error) {
      // Directory doesn't exist or can't be read, continue
    }
  }

  return [...new Set(files)]; // Remove duplicates
}
