#!/usr/bin/env node

/**
 * @fileoverview Command Line Interface for spec-up-t-healthcheck
 * 
 * This CLI tool provides a convenient command-line interface for running health checks
 * on specification repositories. It supports various output formats, check selection,
 * and file output options. The CLI is built using Commander.js and provides a user-friendly
 * interface for all health checking functionality.
 * 
 * @author spec-up-t-healthcheck
 
 */

import { Command } from 'commander';
import { createProvider, runHealthChecks, formatResultsAsText, formatResultsAsJson, formatResultsAsHtml } from '../lib/index.js';
import { openHtmlFile } from '../lib/file-opener.js';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const program = new Command();

program
  .name('spec-up-t-healthcheck')
  .description('Health check tool for spec-up-t repositories')
  .version('1.0.2');

/**
 * Main 'check' command that performs health checks on a repository.
 * 
 * This command creates a provider for the target repository, runs the specified
 * health checks, and outputs the results in the requested format. It supports
 * both local and remote repositories (when implemented) and provides flexible
 * output options.
 * 
 * Exit codes:
 * - 0: All checks passed
 * - 1: One or more checks failed or command error
 * - 2: Checks passed but with warnings
 * 
 * @example
 * ```bash
 * # Basic usage
 * spec-up-t-healthcheck check ./my-repo
 * 
 * # Specific checks only
 * spec-up-t-healthcheck check ./my-repo --checks package-json
 * 
 * # JSON output to file
 * spec-up-t-healthcheck check ./my-repo --format json --output report.json
 * ```
 */
program
  .command('check')
  .description('Run health checks on a repository')
  .argument('<target>', 'Repository path (local) or URL (remote)')
  .option('-c, --checks <checks>', 'Comma-separated list of checks to run (package-json,spec-files)')
  .option('-f, --format <format>', 'Output format (text|json|html)', 'text')
  .option('-o, --output <file>', 'Output file path')
  .option('--no-open', 'Don\'t automatically open HTML reports in browser')
  .action(async (target, options) => {
    try {
      console.log(`\n🔍 Checking: ${target}\n`);
      
      // Parse checks option
      const checks = options.checks ? options.checks.split(',').map(c => c.trim()) : undefined;
      
      // Create provider and run checks
      const provider = createProvider(target);
      const results = await runHealthChecks(provider, { checks });
      
      // Format output based on requested format
      let output;
      let defaultOutputFile;
      
      if (options.format === 'json') {
        output = formatResultsAsJson(results, 2);
        defaultOutputFile = `health-check-${Date.now()}.json`;
      } else if (options.format === 'html') {
        // For HTML, determine repository URL if possible
        let repositoryUrl;
        if (provider.repoPath && !provider.repoPath.startsWith('/')) {
          repositoryUrl = provider.repoPath; // Assume it's a URL
        }
        
        output = formatResultsAsHtml(results, {
          title: `Health Check Report - ${target}`,
          repositoryUrl
        });
        defaultOutputFile = `health-check-${Date.now()}.html`;
      } else {
        output = formatResultsAsText(results);
        defaultOutputFile = `health-check-${Date.now()}.txt`;
      }
      
      // Determine output file path
      let outputFile = options.output;
      if (options.format === 'html' && !outputFile) {
        // For HTML format, create a default output file in .cache directory
        const cacheDir = join(process.cwd(), '.cache');
        if (!existsSync(cacheDir)) {
          mkdirSync(cacheDir, { recursive: true });
        }
        outputFile = join(cacheDir, defaultOutputFile);
      }
      
      // Output results
      if (outputFile) {
        const fs = await import('fs/promises');
        
        // Ensure output directory exists
        const outputDir = dirname(outputFile);
        if (!existsSync(outputDir)) {
          mkdirSync(outputDir, { recursive: true });
        }
        
        await fs.writeFile(outputFile, output);
        console.log(`✅ Results written to ${outputFile}`);
        
        // Automatically open HTML files in browser (unless disabled)
        if (options.format === 'html' && options.open !== false) {
          console.log('🌐 Opening report in browser...');
          const opened = await openHtmlFile(outputFile);
          if (!opened) {
            console.log('💡 Could not automatically open browser. Please open the file manually:');
            console.log(`   ${outputFile}`);
          }
        }
      } else {
        console.log(output);
      }
      
      // Exit with appropriate code
      if (results.summary.hasErrors) {
        process.exit(1);
      } else if (results.summary.hasWarnings) {
        process.exit(2);
      }
      
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * 'list-checks' command that displays available health checks.
 * 
 * This informational command helps users discover what health checks are available
 * and understand what each check validates. It provides descriptions of each check
 * and examples of how to use them.
 */
program
  .command('list-checks')
  .description('List available health checks')
  .action(() => {
    console.log('📋 Available Health Checks:\n');
    console.log('1. package-json      - Validates package.json structure and required fields');
    console.log('2. spec-files        - Finds and validates specification markdown files');
    console.log('3. term-references   - Unresolved refs / dangling defs in index.html (or published gh pages)');
    console.log('\nUsage: spec-up-t-healthcheck check <target> --checks package-json,spec-files,term-references');
  });

/**
 * 'example' command that demonstrates CLI usage patterns.
 * 
 * This command provides practical examples of how to use the CLI tool
 * with different options and scenarios. It helps users understand the
 * available command-line options and common usage patterns.
 */
program
  .command('example')
  .description('Show usage examples')
  .action(() => {
    console.log('📚 Usage Examples:\n');
    console.log('Local repository:');
    console.log('  spec-up-t-healthcheck check ./my-spec-repo\n');
    console.log('Specific checks only:');
    console.log('  spec-up-t-healthcheck check ./repo --checks package-json\n');
    console.log('JSON output:');
    console.log('  spec-up-t-healthcheck check ./repo --format json\n');
    console.log('HTML report (auto-opens in browser):');
    console.log('  spec-up-t-healthcheck check ./repo --format html\n');
    console.log('Save to specific file:');
    console.log('  spec-up-t-healthcheck check ./repo --output report.html --format html\n');
    console.log('HTML report without auto-opening:');
    console.log('  spec-up-t-healthcheck check ./repo --format html --no-open');
  });

/**
 * Parse and execute the command line arguments.
 * This must be called at the end to process user input.
 */
program.parse();
