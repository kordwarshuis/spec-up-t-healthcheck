/**
 * @fileoverview Health check registry system
 * 
 * This module provides a registry system for discovering, registering, and managing
 * health check modules. It enables dynamic loading of health checks and provides
 * a centralized way to manage available checks without hardcoding dependencies.
 * 
 * @author spec-up-t-healthcheck
 */

import { isValidHealthCheckResult } from './health-check-utils.js';

/**
 * @typedef {Object} HealthCheckMetadata
 * @property {string} id - Unique identifier for the health check
 * @property {string} name - Human-readable name
 * @property {string} description - Description of what the check validates
 * @property {function} checkFunction - The actual health check function
 * @property {string} [category='general'] - Category for grouping checks
 * @property {number} [priority=100] - Execution priority (lower = higher priority)
 * @property {string[]} [dependencies=[]] - IDs of checks that must run before this one
 * @property {boolean} [enabled=true] - Whether the check is enabled by default
 */

/**
 * Registry for managing health check modules.
 * This class provides a centralized system for registering, discovering,
 * and executing health checks in a modular fashion.
 */
export class HealthCheckRegistry {
  constructor() {
    /** @type {Map<string, HealthCheckMetadata>} */
    this.checks = new Map();
    
    /** @type {Set<string>} */
    this.categories = new Set(['general']);
    
    /** @type {boolean} */
    this.autoDiscovered = false;
  }

  /**
   * Registers a health check with the registry.
   * 
   * @param {HealthCheckMetadata} metadata - The health check metadata
   * @throws {Error} If the check metadata is invalid or ID already exists
   * 
   * @example
   * ```javascript
   * registry.register({
   *   id: 'my-check',
   *   name: 'My Custom Check',
   *   description: 'Validates something important',
   *   checkFunction: async (provider) => { ... }
   * });
   * ```
   */
  register(metadata) {
    this.validateMetadata(metadata);
    
    if (this.checks.has(metadata.id)) {
      throw new Error(`Health check with ID '${metadata.id}' is already registered`);
    }

    // Set defaults for optional fields
    const fullMetadata = {
      category: 'general',
      priority: 100,
      dependencies: [],
      enabled: true,
      ...metadata
    };

    this.checks.set(metadata.id, fullMetadata);
    this.categories.add(fullMetadata.category);
  }

  /**
   * Validates health check metadata structure.
   * 
   * @param {HealthCheckMetadata} metadata - The metadata to validate
   * @throws {Error} If metadata is invalid
   * @private
   */
  validateMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
      throw new Error('Health check metadata must be an object');
    }

    const requiredFields = ['id', 'name', 'description', 'checkFunction'];
    for (const field of requiredFields) {
      if (!metadata[field]) {
        throw new Error(`Health check metadata missing required field: ${field}`);
      }
    }

    if (typeof metadata.id !== 'string' || metadata.id.trim() === '') {
      throw new Error('Health check ID must be a non-empty string');
    }

    if (typeof metadata.checkFunction !== 'function') {
      throw new Error('Health check function must be a function');
    }

    // Validate optional fields if present
    if (metadata.priority !== undefined && (typeof metadata.priority !== 'number' || metadata.priority < 0)) {
      throw new Error('Health check priority must be a non-negative number');
    }

    if (metadata.dependencies && !Array.isArray(metadata.dependencies)) {
      throw new Error('Health check dependencies must be an array');
    }
  }

  /**
   * Unregisters a health check from the registry.
   * 
   * @param {string} id - The ID of the health check to unregister
   * @returns {boolean} True if the check was removed, false if it wasn't found
   */
  unregister(id) {
    return this.checks.delete(id);
  }

  /**
   * Gets metadata for a specific health check.
   * 
   * @param {string} id - The ID of the health check
   * @returns {HealthCheckMetadata|undefined} The metadata or undefined if not found
   */
  get(id) {
    return this.checks.get(id);
  }

  /**
   * Gets all registered health check IDs.
   * 
   * @returns {string[]} Array of health check IDs
   */
  getAllIds() {
    return Array.from(this.checks.keys());
  }

  /**
   * Gets health checks filtered by category.
   * 
   * @param {string} category - The category to filter by
   * @returns {HealthCheckMetadata[]} Array of health checks in the category
   */
  getByCategory(category) {
    return Array.from(this.checks.values()).filter(check => check.category === category);
  }

  /**
   * Gets all available categories.
   * 
   * @returns {string[]} Array of category names
   */
  getCategories() {
    return Array.from(this.categories);
  }

  /**
   * Checks if a health check is registered.
   * 
   * @param {string} id - The ID to check
   * @returns {boolean} True if the check is registered
   */
  has(id) {
    return this.checks.has(id);
  }

  /**
   * Gets health checks sorted by priority and dependencies.
   * 
   * This method returns checks in an order that respects dependencies
   * and priority settings, ensuring checks run in the correct sequence.
   * 
   * @param {string[]} [requestedIds] - Specific check IDs to include (optional)
   * @returns {HealthCheckMetadata[]} Ordered array of health checks
   */
  getExecutionOrder(requestedIds) {
    const availableChecks = requestedIds 
      ? requestedIds.map(id => this.get(id)).filter(Boolean)
      : Array.from(this.checks.values());

    // Filter only enabled checks
    const enabledChecks = availableChecks.filter(check => check.enabled);

    // Sort by priority, then by ID for consistent ordering
    return enabledChecks.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.id.localeCompare(b.id);
    });
  }

  /**
   * Executes a specific health check.
   * 
   * @param {string} id - The ID of the health check to execute
   * @param {import('./providers.js').Provider} provider - The provider instance
   * @returns {Promise<import('./health-check-utils.js').HealthCheckResult>} The check result
   * @throws {Error} If the check is not registered or execution fails
   */
  async execute(id, provider) {
    const metadata = this.get(id);
    if (!metadata) {
      throw new Error(`Health check '${id}' is not registered`);
    }

    if (!metadata.enabled) {
      throw new Error(`Health check '${id}' is disabled`);
    }

    try {
      const result = await metadata.checkFunction(provider);
      
      // Validate the result structure
      if (!isValidHealthCheckResult(result)) {
        throw new Error(`Health check '${id}' returned invalid result structure`);
      }

      return result;
    } catch (error) {
      throw new Error(`Failed to execute health check '${id}': ${error.message}`);
    }
  }

  /**
   * Automatically discovers and registers health checks from the checks directory.
   * 
   * This method dynamically imports health check modules and registers them
   * with the registry. It's designed to work with the standard module structure.
   * 
   * In browser environments, Node.js-only checks (like link-checker) are skipped.
   */
  async autoDiscover() {
    if (this.autoDiscovered) {
      return; // Avoid duplicate discovery
    }

    try {
      // Detect if we're in a browser environment
      const isBrowser = typeof window !== 'undefined' && typeof process === 'undefined';
      
      // Import the built-in health checks
      const packageJsonModule = await import('./checks/package-json.js');
      const specFilesModule = await import('./checks/spec-files.js');
      const specsJsonModule = await import('./checks/specsjson.js');
      const externalSpecsUrlsModule = await import('./checks/external-specs-urls.js');
      const gitignoreModule = await import('./checks/gitignore.js');
      const specDirectoryAndFilesModule = await import('./checks/spec-directory-and-files.js');
      const consoleMessagesModule = await import('./checks/console-messages.js');
      const markdownTablesModule = await import('./checks/markdown-tables.js');
      const headingHierarchyModule = await import('./checks/heading-hierarchy.js');
      const termReferencesModule = await import('./checks/term-references.js');
      
      // Only import link-checker in Node.js environments (not browsers)
      // Link checker requires linkinator which uses Node.js streams
      let linkCheckerModule = null;
      if (!isBrowser) {
        try {
          linkCheckerModule = await import('./checks/link-checker.js');
        } catch (error) {
          console.warn('Link checker module could not be loaded (Node.js only):', error.message);
        }
      }

      // Register package.json check
      if (packageJsonModule.checkPackageJson && packageJsonModule.CHECK_ID) {
        this.register({
          id: packageJsonModule.CHECK_ID,
          name: packageJsonModule.CHECK_NAME || 'package.json Check',
          description: packageJsonModule.CHECK_DESCRIPTION || 'Validates package.json file',
          checkFunction: packageJsonModule.checkPackageJson,
          category: 'configuration',
          priority: 10 // High priority for configuration checks
        });
      }

      // Register spec files check
      if (specFilesModule.checkSpecFiles && specFilesModule.CHECK_ID) {
        this.register({
          id: specFilesModule.CHECK_ID,
          name: specFilesModule.CHECK_NAME || 'Specification Files Check',
          description: specFilesModule.CHECK_DESCRIPTION || 'Discovers specification files',
          checkFunction: specFilesModule.checkSpecFiles,
          category: 'content',
          priority: 20 // Lower priority, content checks can run after configuration
        });
      }

      // Register specs.json check
      if (specsJsonModule.checkSpecsJson && specsJsonModule.CHECK_ID) {
        this.register({
          id: specsJsonModule.CHECK_ID,
          name: specsJsonModule.CHECK_NAME || 'specs.json Check',
          description: specsJsonModule.CHECK_DESCRIPTION || 'Validates specs.json file',
          checkFunction: specsJsonModule.checkSpecsJson,
          category: 'configuration',
          priority: 15 // Between package-json and spec-files
        });
      }

      // Register external specs URLs check
      if (externalSpecsUrlsModule.checkExternalSpecsUrls && externalSpecsUrlsModule.CHECK_ID) {
        this.register({
          id: externalSpecsUrlsModule.CHECK_ID,
          name: externalSpecsUrlsModule.CHECK_NAME || 'External Specs URL Validation',
          description: externalSpecsUrlsModule.CHECK_DESCRIPTION || 'Validates external specification URLs',
          checkFunction: externalSpecsUrlsModule.checkExternalSpecsUrls,
          category: 'external-references',
          priority: 30 // Run after specs.json is validated
        });
      }

      // Register .gitignore check
      if (gitignoreModule.checkGitignore && gitignoreModule.CHECK_ID) {
        this.register({
          id: gitignoreModule.CHECK_ID,
          name: gitignoreModule.CHECK_NAME || '.gitignore validation',
          description: gitignoreModule.CHECK_DESCRIPTION || 'Validates .gitignore file',
          checkFunction: gitignoreModule.checkGitignore,
          category: 'configuration',
          priority: 12 // After package.json, before specs.json
        });
      }

      // Register spec directory and files check
      if (specDirectoryAndFilesModule.checkSpecDirectoryAndFiles && specDirectoryAndFilesModule.CHECK_ID) {
        this.register({
          id: specDirectoryAndFilesModule.CHECK_ID,
          name: specDirectoryAndFilesModule.CHECK_NAME || 'Spec Directory and Files Check',
          description: specDirectoryAndFilesModule.CHECK_DESCRIPTION || 'Validates spec directories and required files',
          checkFunction: specDirectoryAndFilesModule.checkSpecDirectoryAndFiles,
          category: 'content',
          priority: 16 // After specs.json validation, before general spec files discovery
        });
      }

      // Register console messages check
      if (consoleMessagesModule.checkConsoleMessages) {
        this.register({
          id: consoleMessagesModule.checkConsoleMessagesMetadata?.id || 'console-messages',
          name: consoleMessagesModule.checkConsoleMessagesMetadata?.name || 'Console Messages',
          description: consoleMessagesModule.checkConsoleMessagesMetadata?.description || 'Analyzes console output from operations',
          checkFunction: consoleMessagesModule.checkConsoleMessages,
          category: consoleMessagesModule.checkConsoleMessagesMetadata?.category || 'operations',
          priority: 50 // Run after most other checks as it analyzes operation results
        });
      }

      // Register markdown tables check
      if (markdownTablesModule.checkMarkdownTables && markdownTablesModule.CHECK_ID) {
        this.register({
          id: markdownTablesModule.CHECK_ID,
          name: markdownTablesModule.CHECK_NAME || 'Markdown Table Validation',
          description: markdownTablesModule.CHECK_DESCRIPTION || 'Validates markdown table structure and syntax',
          checkFunction: markdownTablesModule.checkMarkdownTables,
          category: 'content',
          priority: 25 // Run after spec files discovery, before external validations
        });
      }

      // Register heading hierarchy check
      if (headingHierarchyModule.checkHeadingHierarchy && headingHierarchyModule.CHECK_ID) {
        this.register({
          id: headingHierarchyModule.CHECK_ID,
          name: headingHierarchyModule.CHECK_NAME || 'Heading Hierarchy Validation',
          description: headingHierarchyModule.CHECK_DESCRIPTION || 'Validates heading levels do not skip levels',
          checkFunction: headingHierarchyModule.checkHeadingHierarchy,
          category: 'content',
          priority: 26 // Run alongside markdown content checks
        });
      }

      // Register term references check (unresolved refs / dangling defs)
      if (termReferencesModule.checkTermReferences && termReferencesModule.CHECK_ID) {
        this.register({
          id: termReferencesModule.CHECK_ID,
          name: termReferencesModule.CHECK_NAME || 'Term References',
          description: termReferencesModule.CHECK_DESCRIPTION || 'Detects unresolved references and dangling definitions',
          checkFunction: termReferencesModule.checkTermReferences,
          category: 'content',
          priority: 27 // After other markdown content checks
        });
      }

      // Register link checker (Node.js only - not available in browsers)
      if (linkCheckerModule && linkCheckerModule.checkLinks && linkCheckerModule.CHECK_ID) {
        this.register({
          id: linkCheckerModule.CHECK_ID,
          name: linkCheckerModule.CHECK_NAME || 'Link Checker',
          description: linkCheckerModule.CHECK_DESCRIPTION || 'Validates all links in the generated HTML output',
          checkFunction: linkCheckerModule.checkLinks,
          category: 'quality',
          priority: 40 // Run after all file validations complete
        });
      }

      this.autoDiscovered = true;
    } catch (error) {
      console.warn('Failed to auto-discover some health checks:', error.message);
    }
  }

  /**
   * Gets a summary of the registry state.
   * 
   * @returns {Object} Summary information about registered checks
   */
  getSummary() {
    const checks = Array.from(this.checks.values());
    
    return {
      totalChecks: checks.length,
      enabledChecks: checks.filter(c => c.enabled).length,
      disabledChecks: checks.filter(c => !c.enabled).length,
      categories: this.getCategories(),
      checksByCategory: Object.fromEntries(
        this.getCategories().map(cat => [cat, this.getByCategory(cat).length])
      )
    };
  }

  /**
   * Enables or disables a health check.
   * 
   * @param {string} id - The ID of the health check
   * @param {boolean} enabled - Whether to enable or disable the check
   * @returns {boolean} True if the check was found and updated
   */
  setEnabled(id, enabled) {
    const metadata = this.get(id);
    if (metadata) {
      metadata.enabled = enabled;
      return true;
    }
    return false;
  }

  /**
   * Clears all registered health checks.
   * 
   * This method is primarily useful for testing or when reinitializing
   * the registry with a different set of checks.
   */
  clear() {
    this.checks.clear();
    this.categories.clear();
    this.categories.add('general');
    this.autoDiscovered = false;
  }
}

/**
 * Global registry instance for convenient access.
 * Most applications should use this singleton instance.
 * @type {HealthCheckRegistry}
 */
export const globalRegistry = new HealthCheckRegistry();

/**
 * Convenience function to register a health check with the global registry.
 * 
 * @param {HealthCheckMetadata} metadata - The health check metadata
 */
export function registerHealthCheck(metadata) {
  globalRegistry.register(metadata);
}

/**
 * Convenience function to get a health check from the global registry.
 * 
 * @param {string} id - The health check ID
 * @returns {HealthCheckMetadata|undefined} The health check metadata
 */
export function getHealthCheck(id) {
  return globalRegistry.get(id);
}

/**
 * Convenience function to auto-discover health checks using the global registry.
 */
export async function autoDiscoverHealthChecks() {
  await globalRegistry.autoDiscover();
}