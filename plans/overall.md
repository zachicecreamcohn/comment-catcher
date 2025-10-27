# Comment Catcher

A CLI tool and GitHub Action that detects outdated code comments in TypeScript/JavaScript projects after code changes.

## Goal

Identify code comments that may be outdated based on changes in a PR, even when those comments exist in files that depend on the changed code but weren't directly modified.

## Architecture

### Phase 1: CLI Tool

The CLI will:
1. **Generate git diff** against main (or specified branch)
2. **Build dependency graph** using dependency-cruiser for all changed files
3. **Extract code comments** from:
   - Changed files
   - Files that depend on changed files (via dependency graph)
4. **Analyze with LLM**:
   - Input: git diff, extracted comments with their code context
   - Output: list of potentially outdated comments with reasoning
5. **Generate report** (JSON/markdown format)

### Phase 2: GitHub Action Integration

Create a GitHub Actions workflow that:
- Triggers on `pull_request` events
- Runs the CLI tool
- Posts findings as a PR comment using GitHub API (Octokit or `actions/github-script`)
- Shows up as a status check in PR UI

## Technical Stack

- **Language**: TypeScript
- **Target projects**: MERN stack (TypeScript/JavaScript)
- **CLI Framework**: Commander.js
- **Dependencies**:
  - `commander` - CLI framework for commands, options, and arguments
  - `dependency-cruiser` - dependency graph generation
  - `@babel/parser` or TypeScript Compiler API - AST parsing for comment extraction
  - `simple-git` or native git commands - diff generation
  - LLM API (OpenAI, Anthropic, etc.) - comment analysis
  - `@octokit/rest` - GitHub API integration (for Actions)

## Scope Considerations

- **Dependency depth**: May need to limit graph traversal (e.g., only direct dependencies)
- **Comment types**: Focus on inline comments, block comments, and JSDoc
- **Performance**: Cache dependency graphs where possible; consider parallel LLM calls for large comment sets
