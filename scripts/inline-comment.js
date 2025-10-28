#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const BASE_BRANCH = process.env.BASE_BRANCH || 'main';
const DEPTH = process.env.DEPTH || '3';

// Get PR details from GitHub context
const eventPath = process.env.GITHUB_EVENT_PATH;
const repository = process.env.GITHUB_REPOSITORY;
const [owner, repo] = repository.split('/');

let prNumber;
let headSha;
try {
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  prNumber = event.pull_request?.number;
  headSha = event.pull_request?.head?.sha;
  
  if (!prNumber) {
    console.log('Not a pull request event, skipping...');
    process.exit(0);
  }
} catch (error) {
  console.error('Failed to parse GitHub event:', error);
  process.exit(1);
}

// Support GitHub Enterprise with custom API endpoint
const apiBaseUrl = process.env.GITHUB_API_URL || 'https://api.github.com';

// Get PR diff to find line positions
async function getPRDiff() {
  const response = await fetch(
    `${apiBaseUrl}/repos/${owner}/${repo}/pulls/${prNumber}`,
    {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.diff',
        'User-Agent': 'comment-catcher-action'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get PR diff: ${response.statusText}`);
  }

  return response.text();
}

// Parse diff to find line positions for comments
function findCommentPositionsInDiff(diff, outdatedComments) {
  const diffLines = diff.split('\n');
  const positions = [];

  for (const comment of outdatedComments) {
    const filePath = comment.comment.file;
    const commentLine = comment.comment.line;

    // Find the file in the diff
    let inFile = false;
    let currentFile = '';
    let position = 0;
    let currentLineNumber = 0;
    let foundPosition = null;

    for (let i = 0; i < diffLines.length; i++) {
      const line = diffLines[i];

      // Check if we're starting a new file
      if (line.startsWith('diff --git')) {
        const match = line.match(/b\/(.+)$/);
        if (match) {
          currentFile = match[1];
          inFile = currentFile === filePath;
          position = 0;
        }
        continue;
      }

      // Track position within the current file's diff
      if (inFile) {
        position++;

        // Parse the @@ line to get line numbers
        if (line.startsWith('@@')) {
          const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
          if (match) {
            currentLineNumber = parseInt(match[1]) - 1;
          }
          continue;
        }

        // Track line numbers for additions and unchanged lines
        if (line.startsWith('+') || line.startsWith(' ')) {
          currentLineNumber++;
          
          // Check if this is the line with our comment
          if (currentLineNumber === commentLine) {
            foundPosition = position;
            break;
          }
        }
      }
    }

    if (foundPosition !== null) {
      positions.push({
        path: filePath,
        position: foundPosition,
        comment: comment
      });
    } else {
      console.log(`Could not find position for comment at ${filePath}:${commentLine} in diff`);
    }
  }

  return positions;
}

// Create inline review comments
async function createReviewWithComments(commentPositions) {
  if (commentPositions.length === 0) {
    console.log('No comments to post inline');
    return;
  }

  const comments = commentPositions.map(({ path, position, comment }) => {
    let body = `**🔍 Outdated Comment Detected**\n\n`;
    body += `**Current comment:** ${comment.comment.text}\n\n`;
    body += `**Why it's outdated:** ${comment.reason}\n\n`;
    
    if (comment.suggestion) {
      body += `**Suggested update:**\n`;
      body += '```suggestion\n';
      body += comment.suggestion + '\n';
      body += '```\n';
    }

    return {
      path,
      position,
      body
    };
  });

  const reviewBody = {
    commit_id: headSha,
    event: 'COMMENT',
    body: '## 🔍 Comment Catcher Review\n\nI found some potentially outdated comments in this PR. Please review the inline suggestions below.',
    comments
  };

  const response = await fetch(
    `${apiBaseUrl}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'comment-catcher-action'
      },
      body: JSON.stringify(reviewBody)
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create review: ${response.statusText} - ${error}`);
  }

  console.log('Successfully created review with inline comments');
}

// Validate API key is present
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ Error: ANTHROPIC_API_KEY environment variable is not set');
  process.exit(1);
}

// Ensure base branch ref is available
console.log(`Fetching base branch: ${BASE_BRANCH}...`);
try {
  execSync(`git fetch origin ${BASE_BRANCH}:${BASE_BRANCH}`, { stdio: 'pipe' });
  console.log(`Successfully fetched ${BASE_BRANCH}`);
} catch (fetchError) {
  console.log(`Note: Could not fetch ${BASE_BRANCH} (may already exist locally)`);
}

// Main execution
async function main() {
  try {
    // Run comment-catcher to generate JSON report
    const reportPath = path.join(process.cwd(), 'comment-catcher-report.json');
    try {
      execSync(`comment-catcher check -b ${BASE_BRANCH} -d ${DEPTH} -f json -o ${reportPath}`, {
        stdio: 'inherit',
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL
        }
      });
    } catch (error) {
      // comment-catcher exits with code 1 when it finds issues, which is expected
      if (error.status !== 1) {
        throw error; // Re-throw if it's a real error
      }
    }

    // Read the JSON report
    let outdatedComments = [];
    if (fs.existsSync(reportPath)) {
      const reportContent = fs.readFileSync(reportPath, 'utf8');
      outdatedComments = JSON.parse(reportContent);
    }

    if (outdatedComments.length === 0) {
      console.log('No outdated comments found');
      
      // Still create a summary comment
      const summaryBody = `## ✅ Comment Catcher Results

No outdated comments detected. Great job keeping documentation up to date!

---
*This comment was automatically generated by [Comment Catcher](https://github.com/zachicecreamcohn/comment-catcher)*`;

      await fetch(
        `${apiBaseUrl}/repos/${owner}/${repo}/issues/${prNumber}/comments`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'comment-catcher-action'
          },
          body: JSON.stringify({ body: summaryBody })
        }
      );
      
      return;
    }

    // Get the PR diff
    console.log('Getting PR diff...');
    const diff = await getPRDiff();

    // Find positions of comments in the diff
    console.log('Finding comment positions in diff...');
    const commentPositions = findCommentPositionsInDiff(diff, outdatedComments);

    // Create review with inline comments
    console.log(`Creating review with ${commentPositions.length} inline comments...`);
    await createReviewWithComments(commentPositions);

    // Also create a summary comment
    const summaryBody = `## 🔍 Comment Catcher Summary

Found ${outdatedComments.length} potentially outdated comment(s). See the inline review comments above for details and suggested updates.

${commentPositions.length < outdatedComments.length ? `\n⚠️ Note: ${outdatedComments.length - commentPositions.length} comment(s) could not be posted inline because they are not visible in the PR diff.\n` : ''}

---
*This comment was automatically generated by [Comment Catcher](https://github.com/zachicecreamcohn/comment-catcher)*`;

    await fetch(
      `${apiBaseUrl}/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'comment-catcher-action'
        },
        body: JSON.stringify({ body: summaryBody })
      }
    );

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});