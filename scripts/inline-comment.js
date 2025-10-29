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

// Identifier to track our comments
const COMMENT_SIGNATURE = '🔍 Outdated Comment Detected';

// Get PR files to find comment positions
async function getPRFiles() {
  const files = [];
  let page = 1;
  
  while (true) {
    const response = await fetch(
      `${apiBaseUrl}/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'comment-catcher-action'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get PR files: ${response.statusText}`);
    }

    const pageFiles = await response.json();
    if (pageFiles.length === 0) break;
    
    files.push(...pageFiles);
    page++;
  }

  return files;
}

// Find comment positions using PR files API
async function findCommentPositions(prFiles, outdatedComments) {
  const positions = [];
  const notInDiff = [];

  for (const comment of outdatedComments) {
    const file = prFiles.find(f => f.filename === comment.comment.file);
    
    if (!file || !file.patch) {
      console.log(`File ${comment.comment.file} not found in PR changes`);
      notInDiff.push(comment);
      continue;
    }

    // Parse the patch to find the line
    const patchLines = file.patch.split('\n');
    let currentLine = 0;
    let foundPosition = null;

    for (let i = 0; i < patchLines.length; i++) {
      const line = patchLines[i];
      
      // Parse @@ header to get starting line number
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
        if (match) {
          currentLine = parseInt(match[1]) - 1;
        }
        continue;
      }

      // Track line numbers
      if (line.startsWith('+') || line.startsWith(' ')) {
        currentLine++;
        
        if (currentLine === comment.comment.line) {
          // GitHub counts position from the start of the file's patch
          foundPosition = i + 1;
          break;
        }
      }
    }

    if (foundPosition !== null) {
      positions.push({
        path: file.filename,
        position: foundPosition,
        comment: comment
      });
    } else {
      console.log(`Could not find line ${comment.comment.line} in diff for ${comment.comment.file}`);
      notInDiff.push(comment);
    }
  }

  return { positions, notInDiff };
}

// Get existing Comment Catcher reviews
async function getExistingReviews() {
  const response = await fetch(
    `${apiBaseUrl}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
    {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'comment-catcher-action'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get existing reviews: ${response.statusText}`);
  }

  const reviews = await response.json();
  // Filter to only Comment Catcher reviews (by checking the body content)
  return reviews.filter(r => r.body && r.body.includes('Comment Catcher Review'));
}

// Dismiss previous Comment Catcher reviews
async function dismissPreviousReviews() {
  console.log('Checking for previous Comment Catcher reviews...');
  const existingReviews = await getExistingReviews();
  
  for (const review of existingReviews) {
    // Only dismiss if it's not already dismissed and it's from a previous commit
    if (review.state !== 'DISMISSED' && review.commit_id !== headSha) {
      console.log(`Dismissing previous review ${review.id}...`);
      
      const response = await fetch(
        `${apiBaseUrl}/repos/${owner}/${repo}/pulls/${prNumber}/reviews/${review.id}/dismissals`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'comment-catcher-action'
          },
          body: JSON.stringify({
            message: 'Outdated - new Comment Catcher analysis available'
          })
        }
      );

      if (!response.ok) {
        console.error(`Failed to dismiss review ${review.id}: ${response.statusText}`);
      }
    }
  }
}

// Helper to check if a suggestion is actually instructions
function isInstructionNotSuggestion(text) {
  // Check for common instruction patterns
  const instructionPatterns = [
    /^(update|change|modify|add|remove|delete|replace)\s+(the\s+)?(comment\s+)?(to|with):/i,
    /^(you should|please|consider|try to)/i,
    /^["'].*["']$/, // Wrapped in quotes
    /:\s*["'].*["']$/, // Ends with : "quoted text"
  ];
  
  return instructionPatterns.some(pattern => pattern.test(text.trim()));
}

// Clean instruction-style text to extract the actual suggestion
function extractSuggestionFromInstruction(text) {
  // Try to extract text after common patterns
  const patterns = [
    /(?:update|change|modify|add|replace)\s+(?:the\s+)?(?:comment\s+)?(?:to|with):\s*["']?(.*)["']?$/i,
    /:\s*["'](.*)["']$/, // Extract quoted text after colon
    /^["'](.*)["']$/, // Remove surrounding quotes
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return text; // Return original if no pattern matches
}

// Create new review with comments
async function createReviewWithComments(commentPositions) {
  if (commentPositions.length === 0) {
    console.log('No comments to post inline');
    return;
  }

  const comments = commentPositions.map(({ path, position, comment }) => {
    let body = `**${COMMENT_SIGNATURE}**\n\n`;
    body += `**Current comment:** ${comment.comment.text}\n\n`;
    body += `**Why it's outdated:** ${comment.reason}\n\n`;
    
    if (comment.suggestion) {
      // Check if the suggestion is actually instructions
      if (isInstructionNotSuggestion(comment.suggestion)) {
        // Try to extract the actual suggestion
        const extracted = extractSuggestionFromInstruction(comment.suggestion);
        
        if (extracted !== comment.suggestion && !isInstructionNotSuggestion(extracted)) {
          // We successfully extracted a clean suggestion
          body += `**Suggested update:**\n`;
          body += '```suggestion\n';
          body += extracted + '\n';
          body += '```\n';
        } else {
          // Show as regular text, not a suggestion block
          body += `**Suggested update:** ${comment.suggestion}\n`;
        }
      } else {
        // It's a clean suggestion, use the suggestion block
        body += `**Suggested update:**\n`;
        body += '```suggestion\n';
        body += comment.suggestion + '\n';
        body += '```\n';
      }
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

    // Get PR files with patches
    console.log('Getting PR files...');
    const prFiles = await getPRFiles();

    // Find positions of comments in the diff
    console.log('Finding comment positions in diff...');
    const { positions: commentPositions, notInDiff } = await findCommentPositions(prFiles, outdatedComments);

    // Dismiss previous reviews and create new one
    if (commentPositions.length > 0) {
      await dismissPreviousReviews();
      console.log(`Creating review with ${commentPositions.length} inline comments...`);
      await createReviewWithComments(commentPositions);
    }

    // Build summary comment body
    let summaryBody = `## 🔍 Comment Catcher Summary

Found ${outdatedComments.length} potentially outdated comment(s).`;

    if (commentPositions.length > 0) {
      summaryBody += ` See the inline review comments above for details and suggested updates.`;
    }

    // Add comments that couldn't be posted inline
    if (notInDiff.length > 0) {
      summaryBody += `\n\n### ⚠️ Comments not visible in PR diff\n\nThe following outdated comments are in files not modified by this PR but may need attention:\n\n`;
      
      for (const comment of notInDiff) {
        const fileUrl = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${owner}/${repo}/blob/${headSha}/${comment.comment.file}#L${comment.comment.line}`;
        
        summaryBody += `#### 📍 [${comment.comment.file}:${comment.comment.line}](${fileUrl})\n`;
        summaryBody += `**Comment:** ${comment.comment.text}\n\n`;
        summaryBody += `**Why it's outdated:** ${comment.reason}\n`;
        
        if (comment.suggestion) {
          // Check if the suggestion is actually instructions
          if (isInstructionNotSuggestion(comment.suggestion)) {
            // Try to extract the actual suggestion
            const extracted = extractSuggestionFromInstruction(comment.suggestion);
            
            if (extracted !== comment.suggestion && !isInstructionNotSuggestion(extracted)) {
              // We successfully extracted a clean suggestion
              summaryBody += `\n**Suggested update:**\n`;
              summaryBody += '```\n';
              summaryBody += extracted + '\n';
              summaryBody += '```\n';
            } else {
              // Show as regular text, not a code block
              summaryBody += `\n**Suggested update:** ${comment.suggestion}\n`;
            }
          } else {
            // It's a clean suggestion, use the code block
            summaryBody += `\n**Suggested update:**\n`;
            summaryBody += '```\n';
            summaryBody += comment.suggestion + '\n';
            summaryBody += '```\n';
          }
        }
        
        summaryBody += '\n---\n\n';
      }
    }

    summaryBody += `\n*This comment was automatically generated by [Comment Catcher](https://github.com/zachicecreamcohn/comment-catcher)*`;

    // Check for existing summary comment
    const issueComments = await fetch(
      `${apiBaseUrl}/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'comment-catcher-action'
        }
      }
    );

    if (!issueComments.ok) {
      throw new Error(`Failed to get issue comments: ${issueComments.statusText}`);
    }

    const comments = await issueComments.json();
    const existingSummary = comments.find(c => 
      c.body.includes('🔍 Comment Catcher Summary') && 
      c.user.login === 'github-actions[bot]'
    );

    if (existingSummary) {
      // Update existing summary
      console.log('Updating existing summary comment...');
      await fetch(
        `${apiBaseUrl}/repos/${owner}/${repo}/issues/comments/${existingSummary.id}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'comment-catcher-action'
          },
          body: JSON.stringify({ body: summaryBody })
        }
      );
    } else {
      // Create new summary
      console.log('Creating new summary comment...');
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
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});