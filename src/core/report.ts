import { OutdatedComment } from './analyzer.js';

/**
 * Generates a report of outdated comments
 */
export function generateReport(
  outdatedComments: OutdatedComment[],
  format: 'json' | 'markdown' = 'markdown'
): string {
  if (format === 'json') {
    return JSON.stringify(outdatedComments, null, 2);
  }

  // Markdown format
  let report = '# Outdated Comments Report\n\n';

  if (outdatedComments.length === 0) {
    report += 'No outdated comments found.\n';
    return report;
  }

  for (const item of outdatedComments) {
    report += `## ${item.comment.file}:${item.comment.line}\n\n`;
    report += `**Comment:** ${item.comment.text}\n\n`;
    report += `**Reason:** ${item.reason}\n\n`;
    if (item.suggestion) {
      report += `**Suggestion:** ${item.suggestion}\n\n`;
    }
    report += '---\n\n';
  }

  return report;
}
