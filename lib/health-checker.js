/**
 * @fileoverview Health checker module for spec-up-t-healthcheck
 * 
 * This module provides a unified interface for health checking functionality.
 * It acts as a facade for the modular health check system, providing access
 * to individual checks and the orchestrator.
 * 
 * @author spec-up-t-healthcheck
 */

// Import the modular components
import { 
  createHealthCheckResult as utilsCreateHealthCheckResult,
  calculateSummary,
  isValidHealthCheckResult,
  createErrorResult,
  HEALTH_CHECK_STATUSES
} from './health-check-utils.js';

import { 
  globalRegistry,
  HealthCheckRegistry,
  registerHealthCheck,
  getHealthCheck,
  autoDiscoverHealthChecks
} from './health-check-registry.js';

import { 
  HealthCheckOrchestrator,
  globalOrchestrator,
  runHealthChecks as orchestratorRunHealthChecks
} from './health-check-orchestrator.js';

// Import individual check functions directly
import { checkPackageJson } from './checks/package-json.js';
import { checkSpecFiles } from './checks/spec-files.js';
import { checkSpecsJson } from './checks/specsjson.js';
import { checkExternalSpecsUrls } from './checks/external-specs-urls.js';
import { checkGitignore } from './checks/gitignore.js';
import { checkSpecDirectoryAndFiles } from './checks/spec-directory-and-files.js';
import { checkConsoleMessages } from './checks/console-messages.js';
import { checkHeadingHierarchy } from './checks/heading-hierarchy.js';
import { checkTermReferences } from './checks/term-references.js';
// Note: checkLinks (link-checker) is NOT imported here to avoid Node.js dependencies in browsers
// It is dynamically imported by the health-check-registry during auto-discovery in Node.js environments only

// Re-export types for backward compatibility
/**
 * @typedef {import('./health-check-utils.js').HealthCheckResult} HealthCheckResult
 */

/**
 * @typedef {import('./health-check-utils.js').HealthCheckSummary} HealthCheckSummary
 */

/**
 * @typedef {import('./health-check-utils.js').HealthCheckReport} HealthCheckReport
 */

/**
 * Creates a standardized health check result object.
 * 
 * @param {string} check - The identifier/name of the health check being performed
 * @param {'pass'|'fail'|'warn'|'skip'} status - The status of the health check
 * @param {string} message - A human-readable message describing the result
 * @param {Object} [details={}] - Optional additional details about the check
 * @returns {HealthCheckResult} A standardized health check result object
 * 
 * @example
 * ```javascript
 * const result = createHealthCheckResult(
 *   'package-json',
 *   'pass',
 *   'package.json is valid',
 *   { packageData: { name: 'my-spec', version: '1.0.0' } }
 * );
 * ```
 */
export function createHealthCheckResult(check, status, message, details = {}) {
  return utilsCreateHealthCheckResult(check, status, message, details);
}

/**
 * Runs a comprehensive health check suite on a specification repository.
 * 
 * This is the main entry point for performing health checks using the
 * modular orchestrator system.
 * 
 * @param {import('./providers.js').Provider} provider - The provider instance for repository access
 * @param {Object} [options={}] - Configuration options for the health check run
 * @param {string[]} [options.checks] - Array of check names to run (defaults to all registered checks)
 * @param {boolean} [options.continueOnError=true] - Whether to continue on failures
 * @param {number} [options.timeout=30000] - Timeout for individual checks
 * @param {boolean} [options.parallel=false] - Whether to run checks in parallel
 * @returns {Promise<HealthCheckReport>} Complete health check report with results and summary
 * 
 * @example
 * ```javascript
 * const provider = createLocalProvider('/path/to/repo');
 * 
 * // Run all registered checks (default)
 * const report = await runHealthChecks(provider);
 * 
 * // Run specific checks only
 * const customReport = await runHealthChecks(provider, {
 *   checks: ['package-json']
 * });
 * 
 * // Use advanced features
 * const advancedReport = await runHealthChecks(provider, {
 *   parallel: true,
 *   timeout: 10000,
 *   categories: ['configuration']
 * });
 * 
 * console.log(`Health score: ${report.summary.score}%`);
 * console.log(`${report.summary.passed}/${report.summary.total} checks passed`);
 * ```
 */
export async function runHealthChecks(provider, options = {}) {
  // If no specific checks are requested, the orchestrator will automatically
  // run all registered checks via registry.getExecutionOrder()
  // No need to specify defaults here - they come from the registry
  return await orchestratorRunHealthChecks(provider, options);
}

// Re-export modular components for advanced usage
export {
  // Individual check functions
  checkPackageJson,
  checkSpecFiles,
  checkSpecsJson,
  checkExternalSpecsUrls,
  checkGitignore,
  checkSpecDirectoryAndFiles,
  checkConsoleMessages,
  checkHeadingHierarchy,
  checkTermReferences,
  
  // Utils
  calculateSummary,
  isValidHealthCheckResult,
  createErrorResult,
  HEALTH_CHECK_STATUSES,
  
  // Registry
  HealthCheckRegistry,
  globalRegistry,
  registerHealthCheck,
  getHealthCheck,
  autoDiscoverHealthChecks,
  
  // Orchestrator
  HealthCheckOrchestrator,
  globalOrchestrator
};

// Export default function for convenience
export default runHealthChecks;
