/**
 * @fileoverview Main entry point for spec-up-t-healthcheck
 * 
 * This module serves as the primary API for the spec-up-t-healthcheck library,
 * providing convenient access to all core functionality including health checking,
 * result formatting, and provider management. It offers both individual component
 * access and a simplified high-level API.
 * 
 * @author spec-up-t-healthcheck
 
 */

// Re-export provider functionality
export { createProvider, createLocalProvider } from './providers.js';

// Re-export health checking functionality
export { runHealthChecks, createHealthCheckResult, checkPackageJson, checkSpecFiles, checkSpecsJson, checkExternalSpecsUrls, checkGitignore, checkSpecDirectoryAndFiles, checkConsoleMessages, checkHeadingHierarchy, checkTermReferences } from './health-checker.js';

// Re-export formatting functionality
export { formatResultsAsText, formatResultsAsJson, formatResultsAsHtml } from './formatters.js';

// Re-export file opening utilities
export { openFile, openHtmlFile, getOpenCommand } from './file-opener.js';

// Import functions for internal use
import { createProvider } from './providers.js';
import { runHealthChecks } from './health-checker.js';

/**
 * Direct API Usage Examples
 * 
 * For more control over the health checking process, you can use the core functions directly:
 * 
 * @example
 * ```javascript
 * // Direct usage with runHealthChecks (more control)
 * (async () => {
 *     const { createProvider, runHealthChecks } = await import('spec-up-t-healthcheck');
 *     const provider = createProvider('.');
 *     const results = await runHealthChecks(provider, {});
 *     console.log("🚀 ~ Healthcheck results:", results);
 * })().catch(console.error);
 * 
 * // With specific checks
 * (async () => {
 *     const { createProvider, runHealthChecks } = await import('spec-up-t-healthcheck');
 *     const provider = createProvider('./my-project');
 *     const results = await runHealthChecks(provider, {
 *         checks: ['package-json', 'spec-files']
 *     });
 *     console.log("Health score:", results.summary.score + "%");
 *     console.log("Errors:", results.summary.hasErrors);
 * })().catch(console.error);
 * 
 * // Format results in different ways
 * (async () => {
 *     const { createProvider, runHealthChecks, formatResultsAsHtml } = await import('spec-up-t-healthcheck');
 *     const provider = createProvider('.');
 *     const results = await runHealthChecks(provider, {});
 *     
 *     // Generate HTML report
 *     const htmlReport = formatResultsAsHtml(results, {
 *         title: 'My Project Health Check',
 *         repositoryUrl: 'https://github.com/user/repo'
 *     });
 *     
 *     // Save or display the HTML
 *     console.log("HTML report generated");
 * })().catch(console.error);
 * ```
 */

/**
 * Simplified high-level API for performing health checks on a specification repository.
 * 
 * This convenience function combines provider creation and health checking into a single
 * call, making it easy to perform health checks without managing providers manually.
 * It automatically determines the appropriate provider type based on the input.
 * 
 * @param {string} input - The path or URL to the specification repository
 * @param {Object} [options={}] - Configuration options for the health check
 * @param {string[]} [options.checks] - Specific checks to run (defaults to all registered checks)
 * @param {string[]} [options.categories] - Legacy alias for checks parameter
 * @param {Object} [options.providerOptions] - Options to pass to the provider
 * @returns {Promise<import('./health-checker.js').HealthCheckReport>} Complete health check report
 * 
 * @example
 * ```javascript
 * // Check a local repository (runs all registered checks)
 * const report = await healthCheck('/path/to/spec-repo');
 * 
 * // Check with specific options
 * const customReport = await healthCheck('/path/to/spec-repo', {
 *   checks: ['package-json', 'spec-files']
 * });
 * 
 * // Display results
 * console.log(`Health score: ${report.summary.score}%`);
 * if (report.summary.hasErrors) {
 *   console.error('Some health checks failed');
 * }
 * ```
 * 
 * @since 1.0.0
 */
export async function healthCheck(input, options = {}) {
  // Handle legacy 'categories' parameter
  const healthCheckOptions = {
    ...options,
    checks: options.checks || options.categories
    // If neither checks nor categories is provided, orchestrator will run all registered checks
  };
  
  const provider = createProvider(input, options.providerOptions);
  return await runHealthChecks(provider, healthCheckOptions);
}

/**
 * The current version of the spec-up-t-healthcheck library.
 * @type {string}
 * @readonly
 */
export const version = '1.0.2';
