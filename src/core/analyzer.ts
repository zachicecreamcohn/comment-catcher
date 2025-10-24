import Anthropic from '@anthropic-ai/sdk';
import { CodeComment } from './comments.js';
import { loadConfig } from './config.js';

export interface OutdatedComment {
  comment: CodeComment;
  reason: string;
  suggestion?: string;
}

/**
 * Analyzes comments using Claude to determine if they're outdated
 */
export async function analyzeComments(
  comments: CodeComment[],
  diff: string
): Promise<OutdatedComment[]> {
  const config = await loadConfig();

  const apiKeyEnvVar = 'ANTHROPIC_API_KEY';
  const apiKey = process.env[apiKeyEnvVar];

  if (!apiKey) {
    throw new Error(`${apiKeyEnvVar} environment variable is required`);
  }

  if (comments.length === 0) {
    return [];
  }

  // Get base URL from env var, config value, or default
  const baseURLEnvVar = 'ANTHROPIC_BASE_URL';
  const baseURL = process.env[baseURLEnvVar] || config.llmOptions?.baseURL || 'https://api.anthropic.com';

  const anthropic = new Anthropic({
    apiKey,
    baseURL,
  });

  // Process comments in batches to avoid memory issues
  const BATCH_SIZE = 50;
  const allOutdatedComments: OutdatedComment[] = [];
  const totalBatches = Math.ceil(comments.length / BATCH_SIZE);

  for (let i = 0; i < comments.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = comments.slice(i, i + BATCH_SIZE);

    if (totalBatches > 1) {
      console.log(`   Processing batch ${batchNum}/${totalBatches} (${batch.length} comments)...`);
    }

    const batchResults = await analyzeCommentBatch(anthropic, batch, diff, config);
    allOutdatedComments.push(...batchResults);
  }

  // Deduplicate and consolidate multiple entries for the same comment
  if (allOutdatedComments.length > 0) {
    console.log('   Deduplicating results...');
  }
  const deduplicated = await deduplicateComments(anthropic, allOutdatedComments, config);

  return deduplicated;
}

async function deduplicateComments(
  anthropic: Anthropic,
  comments: OutdatedComment[],
  config: any
): Promise<OutdatedComment[]> {
  // Group by file + line
  const grouped = new Map<string, OutdatedComment[]>();

  for (const comment of comments) {
    const key = `${comment.comment.file}:${comment.comment.line}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(comment);
  }

  const deduplicated: OutdatedComment[] = [];

  for (const [key, duplicates] of grouped.entries()) {
    if (duplicates.length === 1) {
      // No duplicates, keep as is
      deduplicated.push(duplicates[0]);
    } else {
      // Multiple entries for same comment - ask AI to consolidate
      console.log(`   Consolidating ${duplicates.length} entries for ${key}...`);
      const consolidated = await consolidateReasons(anthropic, duplicates, config);
      deduplicated.push(consolidated);
    }
  }

  return deduplicated;
}

async function consolidateReasons(
  anthropic: Anthropic,
  duplicates: OutdatedComment[],
  config: any
): Promise<OutdatedComment> {
  const comment = duplicates[0].comment;
  const reasons = duplicates.map((d, i) => `${i + 1}. ${d.reason}`).join('\n\n');
  const suggestions = duplicates
    .filter(d => d.suggestion)
    .map((d, i) => `${i + 1}. ${d.suggestion}`)
    .join('\n\n');

  const prompt = `You have multiple analyses of why the same comment is outdated.
Please consolidate these into the top 2 most important and distinct reasons.

Comment: "${comment.text}"
File: ${comment.file}:${comment.line}

Multiple reasons given:
${reasons}

${suggestions ? `Multiple suggestions given:\n${suggestions}\n` : ''}

Task:
1. Identify the top 2 most important and distinct reasons why this comment is outdated
2. Combine any overlapping reasons into a single clear reason
3. Provide one consolidated suggestion for how to update the comment

Return your analysis as a consolidated reason and suggestion.`;

  const response = await anthropic.messages.create({
    model: config.llmOptions?.model || 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    tools: [
      {
        name: 'consolidate_comment_analysis',
        description: 'Provide consolidated analysis of why a comment is outdated',
        input_schema: {
          type: 'object',
          properties: {
            consolidated_reason: {
              type: 'string',
              description: 'The top 2 most important reasons, combined into a clear explanation',
            },
            consolidated_suggestion: {
              type: 'string',
              description: 'A single, clear suggestion for updating the comment',
            },
          },
          required: ['consolidated_reason', 'consolidated_suggestion'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'consolidate_comment_analysis' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    // Fallback to first entry if consolidation fails
    return duplicates[0];
  }

  const result = toolUse.input as {
    consolidated_reason: string;
    consolidated_suggestion: string;
  };

  return {
    comment,
    reason: result.consolidated_reason,
    suggestion: result.consolidated_suggestion,
  };
}

async function analyzeCommentBatch(
  anthropic: Anthropic,
  comments: CodeComment[],
  diff: string,
  config: any
): Promise<OutdatedComment[]> {
  const prompt = buildPrompt(comments, diff);

  const response = await anthropic.messages.create({
    model: config.llmOptions?.model || 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    tools: [
      {
        name: 'report_outdated_comments',
        description: 'Report comments that are likely outdated based on code changes',
        input_schema: {
          type: 'object',
          properties: {
            outdated_comments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  file: { type: 'string', description: 'File path' },
                  line: { type: 'number', description: 'Line number' },
                  comment_text: { type: 'string', description: 'The comment text' },
                  reason: { type: 'string', description: 'Why this comment is outdated' },
                  suggestion: { type: 'string', description: 'Optional suggestion for updating the comment' },
                },
                required: ['file', 'line', 'comment_text', 'reason'],
              },
            },
          },
          required: ['outdated_comments'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'report_outdated_comments' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    return [];
  }

  const result = toolUse.input as { outdated_comments: any[] };

  return result.outdated_comments.map((item) => {
    const originalComment = comments.find(
      (c) => c.file === item.file && c.line === item.line
    );

    return {
      comment: originalComment || {
        file: item.file,
        line: item.line,
        text: item.comment_text,
        context: '',
      },
      reason: item.reason,
      suggestion: item.suggestion,
    };
  });
}

function buildPrompt(comments: CodeComment[], diff: string): string {
  // Parse diff to find deleted comments
  const deletedComments = extractDeletedComments(diff);

  return `You are analyzing code comments to determine if they are outdated based on recent changes.

# Git Diff (changes made):
\`\`\`diff
${diff}
\`\`\`

# Important Notes:
- Comments that appear in DELETED lines (lines starting with -) in the diff above have already been removed from the code
- Only analyze comments that CURRENTLY EXIST in the codebase (listed below)
- Do NOT flag comments that were already deleted in the diff

# Currently Existing Comments to Analyze:
${comments.map((c, i) => `
## Comment ${i + 1}
File: ${c.file}
Line: ${c.line}
Comment: ${c.text}
Context:
\`\`\`
${c.context}
\`\`\`
`).join('\n')}

# Deleted Comments (DO NOT FLAG THESE - they're already removed):
${deletedComments.length > 0 ? deletedComments.join('\n') : 'None'}

# Task
Analyze each CURRENTLY EXISTING comment and determine if it's likely outdated based on the code changes in the diff.
A comment is outdated if:
- It describes behavior that has changed
- It refers to code that was removed or significantly modified
- It references function signatures, parameters, or return values that changed
- It describes implementation details that are no longer accurate

Only flag comments that:
1. Currently exist in the codebase (from the list above)
2. Are clearly or likely outdated based on the changes

For each outdated comment, provide:
- The file and line number (must match one from "Currently Existing Comments")
- The comment text
- A clear reason why it's outdated
- An optional suggestion for how to update it`;
}

function extractDeletedComments(diff: string): string[] {
  const deletedComments: string[] = [];
  const lines = diff.split('\n');

  for (const line of lines) {
    // Look for deleted lines that contain comments
    if (line.startsWith('-') && !line.startsWith('---')) {
      // Match various comment patterns
      const commentPatterns = [
        /\/\/(.+)$/,           // Single line //
        /\/\*(.+?)\*\//,       // Inline /* */
        /^\s*\*\s+(.+)$/,      // Block comment continuation
      ];

      for (const pattern of commentPatterns) {
        const match = line.match(pattern);
        if (match) {
          deletedComments.push(match[1].trim());
        }
      }
    }
  }

  return deletedComments;
}
