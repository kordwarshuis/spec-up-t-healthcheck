/**
 * @fileoverview Shared result details formatter for health check results
 * 
 * This module provides functions to format health check result details into HTML.
 * It works in both Node.js and browser environments, enabling consistent display
 * of health check results in CLI tools, HTML reports, and web applications.
 * 
 * The module formats:
 * - Errors array with red styling
 * - Warnings array with yellow/orange styling
 * - Success messages array with green styling
 * - Additional metadata (missingFields, count, packageData)
 * 
 * URLs in messages are automatically converted to clickable links.
 * 
 * @author spec-up-t-healthcheck
 */

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * This is critical for security when displaying user-generated content.
 * 
 * @param {string|any} text - Text to escape
 * @returns {string} HTML-escaped text
 * 
 * @example
 * ```javascript
 * escapeHtml('<script>alert("xss")</script>');
 * // Returns: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 * ```
 */
export function escapeHtml(text) {
  if (typeof text !== 'string') {
    return String(text);
  }
  
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Converts URLs in text to clickable links that open in a new tab.
 * The text is first escaped for HTML safety, then URLs are converted to links.
 * 
 * This function enhances user experience by making URLs in error messages,
 * warnings, and other feedback immediately actionable.
 * 
 * @param {string} text - Text potentially containing URLs
 * @returns {string} HTML string with clickable links
 * 
 * @example
 * ```javascript
 * linkifyUrls('Check https://example.com for details');
 * // Returns: 'Check <a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a> for details'
 * ```
 */
export function linkifyUrls(text) {
  if (typeof text !== 'string') {
    return escapeHtml(String(text));
  }
  
  // First escape the text for HTML safety
  const escaped = escapeHtml(text);
  
  // URL regex pattern that matches http://, https://, and www. URLs
  // Excludes common trailing punctuation like ), >, ", and whitespace
  const urlPattern = /(https?:\/\/[^\s<>"()]+|www\.[^\s<>"()]+)/g;
  
  // Replace URLs with clickable links
  return escaped.replace(urlPattern, (url) => {
    // Ensure the URL has a protocol for the href attribute
    const href = url.startsWith('http') ? url : `https://${url}`;
    
    // Create an anchor tag that opens in a new tab with security attributes
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-decoration-underline">${url}</a>`;
  });
}

/**
 * Formats result details into HTML.
 * 
 * This is the main formatter function that converts a health check result's
 * details object into a formatted HTML string. It handles:
 * - Errors: Displayed in red with bullet points
 * - Warnings: Displayed in yellow/orange with bullet points
 * - Success: Displayed in green with bullet points (can be hidden for brevity)
 * - Info: Displayed in muted gray with bullet points (contextual information)
 * - Metadata: Missing fields, counts, package data
 * - Console Messages: Special table format for console output (timestamp, type, message, operation, additionalData)
 * 
 * All URLs in messages are automatically converted to clickable links.
 * 
 * @param {Object} details - The details object from a health check result
 * @param {string[]} [details.errors] - Array of error messages
 * @param {string[]} [details.warnings] - Array of warning messages
 * @param {string[]} [details.success] - Array of success messages
 * @param {string[]} [details.info] - Array of informational messages
 * @param {string[]} [details.missingFields] - Array of missing field names
 * @param {number} [details.count] - Count of items found
 * @param {Object} [details.packageData] - Package metadata
 * @param {string} [details.packageData.name] - Package name
 * @param {string} [details.packageData.version] - Package version
 * @param {Object} [details.analysis] - Console message analysis data
 * @param {Array} [details.allMessages] - All console messages for table display
 * @returns {string} Formatted HTML string
 * 
 * @example
 * ```javascript
 * const details = {
 *   errors: ['Field "title" is missing'],
 *   warnings: ['Field "favicon" is recommended'],
 *   success: ['Field "author" exists'],
 *   info: ['URL accessibility checks skipped (browser environment)']
 * };
 * const html = formatResultDetails(details);
 * // Returns formatted HTML with error, warning, success, and info lists
 * ```
 */
export function formatResultDetails(details) {
  let html = '';
  
  // Special handling for console-messages check with errors/warnings
  // Show compact error/warning list first, then full messages table
  if (details.analysis && details.allMessages) {
    // Show errors first (compact format for quick scanning)
    if (details.errors && details.errors.length > 0) {
      const isConsoleMessageFormat = typeof details.errors[0] === 'object' && details.errors[0].timestamp;
      if (isConsoleMessageFormat) {
        html += formatConsoleMessageList('Errors', details.errors, 'danger');
        if (details.errorsNote) {
          html += `<div class="mt-1"><small class="text-muted">${escapeHtml(details.errorsNote)}</small></div>`;
        }
      }
    }
    
    // Show warnings (compact format)
    if (details.warnings && details.warnings.length > 0) {
      const isConsoleMessageFormat = typeof details.warnings[0] === 'object' && details.warnings[0].timestamp;
      if (isConsoleMessageFormat) {
        html += formatConsoleMessageList('Warnings', details.warnings, 'warning');
        if (details.warningsNote) {
          html += `<div class="mt-1"><small class="text-muted">${escapeHtml(details.warningsNote)}</small></div>`;
        }
      }
    }
    
    // Add the full messages table (with all message types)
    html += formatConsoleMessagesTable(details);
    return html;
  }
  
  // Special handling for markdown-tables check
  if (details.details && Array.isArray(details.details)) {
    html += formatMarkdownTablesDetails(details);
    return html;
  }

  // Special handling for term-references check (unresolved refs / dangling defs)
  if (
    Array.isArray(details.unresolvedReferences) ||
    Array.isArray(details.danglingDefinitions)
  ) {
    html += formatTermReferencesDetails(details);
    return html;
  }
  
  // Display errors array with clickable URLs
  // Errors are shown with strong red styling to draw immediate attention
  if (details.errors && details.errors.length > 0) {
    // Check if errors are objects (from console-messages) or strings (from other checks)
    const isConsoleMessageFormat = typeof details.errors[0] === 'object' && details.errors[0].timestamp;
    
    if (isConsoleMessageFormat) {
      html += formatConsoleMessageList('Errors', details.errors, 'danger');
      if (details.errorsNote) {
        html += `<small class="text-muted">${escapeHtml(details.errorsNote)}</small>`;
      }
    } else if (Array.isArray(details.errors)) {
      html += `<div class="mt-2 detail-errors"><strong class="text-danger">Errors:</strong><ul class="mb-0 mt-1">`;
      details.errors.forEach(error => {
        html += `<li class="text-danger">${linkifyUrls(error)}</li>`;
      });
      html += `</ul></div>`;
    }
  }
  
  // Display warnings array with clickable URLs
  // Warnings indicate potential issues that should be addressed but aren't critical
  if (details.warnings && details.warnings.length > 0) {
    // Check if warnings are objects (from console-messages) or strings (from other checks)
    const isConsoleMessageFormat = typeof details.warnings[0] === 'object' && details.warnings[0].timestamp;
    
    if (isConsoleMessageFormat) {
      html += formatConsoleMessageList('Warnings', details.warnings, 'warning');
      if (details.warningsNote) {
        html += `<small class="text-muted">${escapeHtml(details.warningsNote)}</small>`;
      }
    } else if (Array.isArray(details.warnings)) {
      html += `<div class="mt-2 detail-warnings"><strong class="text-warning">Warnings:</strong><ul class="mb-0 mt-1">`;
      details.warnings.forEach(warning => {
        html += `<li class="text-warning">${linkifyUrls(warning)}</li>`;
      });
      html += `</ul></div>`;
    }
  }
  
  // Display success messages array with clickable URLs
  // Add detail-success class so these can be hidden when "Show passing checks" is disabled
  // This helps users focus on issues while still providing complete information when needed
  if (Array.isArray(details.success) && details.success.length > 0) {
    html += `<div class="mt-2 detail-success"><strong class="text-success">Success:</strong><ul class="mb-0 mt-1">`;
    details.success.forEach(success => {
      html += `<li class="text-success">${linkifyUrls(success)}</li>`;
    });
    html += `</ul></div>`;
  }
  
  // Display informational messages array with clickable URLs
  // Info messages provide additional context without indicating success or failure
  if (Array.isArray(details.info) && details.info.length > 0) {
    html += `<div class="mt-2 detail-info"><strong class="text-info">Info:</strong><ul class="mb-0 mt-1">`;
    details.info.forEach(info => {
      html += `<li class="text-muted">${linkifyUrls(info)}</li>`;
    });
    html += `</ul></div>`;
  }
  
  // Display missing fields (existing functionality for backward compatibility)
  // Provides a quick summary of what's missing in validation results
  if (details.missingFields && details.missingFields.length > 0) {
    html += `<br><small class="text-muted">Missing fields: ${details.missingFields.map(escapeHtml).join(', ')}</small>`;
  }
  
  // Display count (existing functionality)
  // Shows the number of items found in checks that count resources
  if (details.count !== undefined) {
    html += `<br><small class="text-muted">Files found: ${details.count}</small>`;
  }
  
  // Display package data (existing functionality)
  // Shows package name and version for package.json validation
  if (details.packageData) {
    html += `<br><small class="text-muted">Package: ${escapeHtml(details.packageData.name)}@${escapeHtml(details.packageData.version)}</small>`;
  }
  
  return html;
}

/**
 * Formats console messages in a compact list format.
 * This is used when showing errors/warnings from console-messages check.
 * 
 * @param {string} title - Title for the list (e.g., "Errors", "Warnings")
 * @param {Array<Object>} messages - Array of console message objects
 * @param {string} colorClass - Bootstrap color class ('danger', 'warning', etc.)
 * @returns {string} HTML string with formatted list
 */
export function formatConsoleMessageList(title, messages, colorClass) {
  let html = `<div class="mt-2"><strong class="text-${colorClass}">${escapeHtml(title)}:</strong>`;
  html += `<div class="table-responsive mt-2"><table class="table-sm" style="width: 100%; background-color: transparent;">`;
  html += `<thead>`;
  html += `<tr>`;
  // html += `<th style="width: 150px; background-color: transparent">Timestamp</th>`;
  html += `<th class="d-none" style="background-color: transparent">Message</th>`;
  html += `</tr>`;
  html += `</thead>`;
  html += `<tbody>`;
  
  messages.forEach(msg => {
    const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : 'N/A';
    const message = msg.message || '';
    const additionalData = msg.additionalData ? ` [${Array.isArray(msg.additionalData) ? msg.additionalData.join(', ') : msg.additionalData}]` : '';
    
    html += `<tr>`;
    // html += `<td><small>${escapeHtml(timestamp)}</small></td>`;
    html += `<td><small>${linkifyUrls(message + additionalData)}</small></td>`;
    html += `</tr>`;
  });
  
  html += `</tbody></table></div></div>`;
  return html;
}

/**
 * Formats all console messages in a detailed table format.
 * This is used when the check includes allMessages for verbose display.
 * 
 * @param {Object} details - Details object containing console message data
 * @returns {string} HTML string with formatted table
 */
export function formatConsoleMessagesTable(details) {
  const { analysis, allMessages, metadata } = details;
  
  let html = '<div class="mt-3">';
  
  // // Add a clear heading for the full messages table
  // html += `<div class="mb-3">`;
  // html += `<strong class="text-primary">All Console Messages (${allMessages.length}):</strong><br>`;
  // html += `<small class="text-muted">Complete log of all operations with timestamp, type, and details</small>`;
  // html += `</div>`;
  
  // // Add summary statistics
  // if (analysis) {
  //   html += `<div class="mb-3">`;
  //   html += `<strong>Summary:</strong><br>`;
  //   html += `<small class="text-muted">`;
  //   html += `Total: ${analysis.totalMessages || 0} | `;
  //   html += `<span class="text-success">Success: ${analysis.successCount || 0}</span> | `;
  //   html += `<span class="text-danger">Errors: ${analysis.errorCount || 0}</span> | `;
  //   html += `<span class="text-warning">Warnings: ${analysis.warningCount || 0}</span>`;
  //   html += `</small>`;
  //   html += `</div>`;
  // }
  
  // // Add operations info if available
  // if (metadata && metadata.operations && metadata.operations.length > 0) {
  //   html += `<div class="mb-2">`;
  //   html += `<small class="text-muted">Operations: ${metadata.operations.map(escapeHtml).join(', ')}</small>`;
  //   html += `</div>`;
  // }
  
  // Create the messages table (without Operation column)
  html += `<div class="table-responsive">`;
  html += `<table class="table-sm table-striped" style="width: 100%;">`;
  html += `<thead class="table-light">`;
  html += `<tr>`;
  // html += `<th style="width: 150px;">Timestamp</th>`;
  // html += `<th style="width: 80px;">Type</th>`;
  html += `<th class="d-none">Message</th>`;
  // html += `<th style="width: 150px;">Additional Data</th>`;
  html += `</tr>`;
  html += `</thead>`;
  html += `<tbody>`;
  
  // Format each message as a table row
  allMessages.forEach(msg => {
    const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : 'N/A';
    const type = msg.type || 'info';
    const message = msg.message || '';
    const additionalData = msg.additionalData 
      ? (Array.isArray(msg.additionalData) ? msg.additionalData.join(', ') : String(msg.additionalData))
      : '';
    
    // Apply color based on message type
    let typeClass = 'text-muted';
    let typeBadge = 'secondary';
    switch (type) {
      case 'error':
        typeClass = 'text-danger';
        typeBadge = 'danger';
        break;
      case 'warn':
        typeClass = 'text-warning';
        typeBadge = 'warning';
        break;
      case 'success':
        typeClass = 'text-success';
        typeBadge = 'success';
        break;
      case 'info':
        typeClass = 'text-info';
        typeBadge = 'info';
        break;
      case 'highlight':
        typeClass = 'text-primary';
        typeBadge = 'primary';
        break;
    }
    
    html += `<tr>`;
    // html += `<td><small>${escapeHtml(timestamp)}</small></td>`;
    // html += `<td><span class="badge bg-${typeBadge}">${escapeHtml(type)}</span></td>`;
    html += `<td><small>${linkifyUrls(message)}</small></td>`;
    // html += `<td><small class="text-muted">${escapeHtml(additionalData)}</small></td>`;
    html += `</tr>`;
  });
  
  html += `</tbody></table></div></div>`;
  
  return html;
}

/**
 * Formats term-references check details into HTML.
 *
 * Shows Unresolved References and Dangling Definitions in the same style as
 * the reports from spec-up-t menu option 4.
 *
 * @param {Object} details - Details from the term-references health check
 * @param {string[]} [details.unresolvedReferences] - Terms referenced but not defined
 * @param {string[]} [details.danglingDefinitions] - Terms defined but never referenced
 * @param {Object} [details.hints] - Optional remediation hints
 * @returns {string} HTML string with formatted term reference issues
 */
export function formatTermReferencesDetails(details) {
  let html = '<div class="mt-2">';

  if (Array.isArray(details.unresolvedReferences) && details.unresolvedReferences.length > 0) {
    html += `<div class="mt-2 detail-warnings">`;
    html += `<strong class="text-warning">Unresolved References (${details.unresolvedReferences.length}):</strong>`;
    html += `<ul class="mb-0 mt-1">`;
    details.unresolvedReferences.forEach(term => {
      html += `<li class="text-warning"><code>${escapeHtml(term)}</code></li>`;
    });
    html += `</ul>`;
    if (details.hints && details.hints.unresolved) {
      html += `<small class="text-muted">${escapeHtml(details.hints.unresolved)}</small>`;
    }
    html += `</div>`;
  }

  if (Array.isArray(details.danglingDefinitions) && details.danglingDefinitions.length > 0) {
    html += `<div class="mt-2 detail-warnings">`;
    html += `<strong class="text-warning">Dangling Definitions (${details.danglingDefinitions.length}):</strong>`;
    html += `<ul class="mb-0 mt-1">`;
    details.danglingDefinitions.forEach(term => {
      html += `<li class="text-warning"><code>${escapeHtml(term)}</code></li>`;
    });
    html += `</ul>`;
    if (details.hints && details.hints.dangling) {
      html += `<small class="text-muted">${escapeHtml(details.hints.dangling)}</small>`;
    }
    html += `</div>`;
  }

  if (
    (!details.unresolvedReferences || details.unresolvedReferences.length === 0) &&
    (!details.danglingDefinitions || details.danglingDefinitions.length === 0)
  ) {
    html += `<small class="text-muted">Refs: ${details.referenceCount || 0}, Defs: ${details.definitionCount || 0}</small>`;
  }

  html += '</div>';
  return html;
}

/**
 * Formats markdown tables details into HTML.
 * 
 * @param {Object} details - Details object containing markdown tables data
 * @returns {string} HTML string with formatted table issues
 */
export function formatMarkdownTablesDetails(details) {
  const { details: fileResults } = details;
  
  let html = '<div class="mt-2">';
  html += '<div class="table-responsive">';
  html += '<table class="table table-sm table-striped">';
  html += '<thead class="table-light">';
  html += '<tr>';
  html += '<th>File</th>';
  html += '<th>Line</th>';
  html += '<th>Issue</th>';
  html += '<th>Content</th>';
  html += '</tr>';
  html += '</thead>';
  html += '<tbody>';
  
  fileResults.forEach(fileResult => {
    fileResult.tables.forEach(table => {
      table.issues.forEach(issue => {
        const severityClass = issue.severity === 'error' ? 'text-danger' : 
                             issue.severity === 'warning' ? 'text-warning' : 'text-info';
        const severityIcon = issue.severity === 'error' ? 'bi-exclamation-triangle-fill' :
                            issue.severity === 'warning' ? 'bi-exclamation-circle-fill' : 'bi-info-circle-fill';
        
        html += '<tr>';
        html += `<td><small><code>${escapeHtml(fileResult.file)}</code></small></td>`;
        html += `<td><small>${issue.line}</small></td>`;
        html += `<td><small class="${severityClass}"><i class="bi ${severityIcon}"></i> ${escapeHtml(issue.message)}</small></td>`;
        html += `<td><small class="text-muted">${escapeHtml(issue.content || '')}</small></td>`;
        html += '</tr>';
      });
    });
  });
  
  html += '</tbody>';
  html += '</table>';
  html += '</div>';
  html += '</div>';
  
  return html;
}

/**
 * Formats a single health check result into a table row HTML string.
 * 
 * This function is useful for building tables of health check results.
 * It includes status badges, check names, messages, and formatted details.
 * 
 * @param {Object} result - A health check result object
 * @param {string} result.status - Status of the check ('pass', 'fail', 'warn', 'skip')
 * @param {string} result.check - Name of the health check
 * @param {string} result.message - Primary message describing the result
 * @param {Object} [result.details] - Additional details to format
 * @returns {string} HTML table row string
 * 
 * @example
 * ```javascript
 * const result = {
 *   status: 'fail',
 *   check: 'specs.json validation',
 *   message: 'specs.json has 2 error(s)',
 *   details: {
 *     errors: ['Field "title" is missing', 'Field "author" is empty']
 *   }
 * };
 * const rowHtml = formatResultAsTableRow(result);
 * ```
 */
export function formatResultAsTableRow(result) {
  const { statusClass, statusIcon, statusText } = getStatusDisplay(result);
  const rowClass = getRowClass(result);
  
  let detailsHtml = '';
  if (result.details && Object.keys(result.details).length > 0) {
    detailsHtml = formatResultDetails(result.details);
  }

  return `<tr data-status="${result.status}" class="check-row ${rowClass}">
    <td class="${statusClass} status-badge">
      <i class="bi ${statusIcon} status-icon"></i>
      <span>${statusText}</span>
    </td>
    <td>${escapeHtml(result.check)}</td>
    <td>
      ${escapeHtml(result.message)}
      ${detailsHtml}
    </td>
  </tr>`;
}

/**
 * Gets display properties (class, icon, text) for a result status.
 * 
 * This helper function centralizes the mapping between status values
 * and their visual representation, ensuring consistency across the UI.
 * 
 * @param {Object} result - The health check result
 * @param {string} result.status - Status value ('pass', 'fail', 'warn', 'skip')
 * @returns {{statusClass: string, statusIcon: string, statusText: string}}
 * 
 * @example
 * ```javascript
 * const display = getStatusDisplay({ status: 'fail' });
 * // Returns: {
 * //   statusClass: 'text-danger',
 * //   statusIcon: 'bi-x-circle-fill',
 * //   statusText: 'Fail'
 * // }
 * ```
 */
export function getStatusDisplay(result) {
  switch (result.status) {
    case 'pass':
      return {
        statusClass: 'text-success',
        statusIcon: 'bi-check-circle-fill',
        statusText: 'Pass'
      };
    case 'fail':
      return {
        statusClass: 'text-danger',
        statusIcon: 'bi-x-circle-fill',
        statusText: 'Fail'
      };
    case 'warn':
      return {
        statusClass: 'text-warning',
        statusIcon: 'bi-exclamation-triangle-fill',
        statusText: 'Warning'
      };
    case 'skip':
      return {
        statusClass: 'text-muted',
        statusIcon: 'bi-dash-circle',
        statusText: 'Skipped'
      };
    default:
      return {
        statusClass: 'text-secondary',
        statusIcon: 'bi-question-circle',
        statusText: 'Unknown'
      };
  }
}

/**
 * Gets the appropriate CSS class for a table row based on the result status.
 * 
 * This provides Bootstrap table row styling to visually distinguish
 * different result statuses in tabular displays.
 * 
 * @param {Object} result - The health check result
 * @param {string} result.status - Status value ('pass', 'fail', 'warn')
 * @returns {string} CSS class name
 * 
 * @example
 * ```javascript
 * const rowClass = getRowClass({ status: 'fail' });
 * // Returns: 'table-danger'
 * ```
 */
export function getRowClass(result) {
  switch (result.status) {
    case 'fail':
      return 'table-danger';
    case 'warn':
      return 'table-warning';
    case 'pass':
      return 'table-success';
    default:
      return '';
  }
}
