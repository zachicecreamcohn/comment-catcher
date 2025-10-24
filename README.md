# Comment Catcher

A CLI tool that detects outdated code comments in TypeScript/JavaScript projects using AI analysis.

## Features

- 🔍 Analyzes git diffs to find code changes
- 🔗 Uses dependency graphs to find affected files beyond direct changes
- 💬 Extracts code comments using AST parsing
- 🤖 Uses Claude AI to intelligently identify outdated comments
- 📊 Generates markdown or JSON reports

## Installation

### As a Development Tool (Recommended)

Install in your project:

```bash
npm install --save-dev comment-catcher
# or
yarn add -D comment-catcher
# or
pnpm add -D comment-catcher
```

Then add to your `package.json` scripts:

```json
{
  "scripts": {
    "check-comments": "comment-catcher check"
  }
}
```

### Global Installation

```bash
npm install -g comment-catcher
```

### From Source

```bash
git clone https://github.com/zachicecreamcohn/comment-catcher.git
cd comment-catcher
npm install
npm run build
```

## Usage

### Prerequisites

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=your_api_key_here
```

**Optional:** If you're using a custom API endpoint (e.g., a proxy or alternative provider):

```bash
export ANTHROPIC_BASE_URL=https://your-custom-endpoint.com
```

### Basic Usage

```bash
# If installed as dev dependency
npm run check-comments

# If installed globally
comment-catcher check

# From source
npm start check
```

### Options

```bash
npm start check [options]

Options:
  -b, --base <branch>     Base branch to compare against (default: "main")
  -d, --depth <number>    Dependency graph depth to traverse (default: "3")
  -o, --output <file>     Output file for the report
  -f, --format <format>   Output format: markdown or json (default: "markdown")
  --no-deps               Skip dependency analysis (only check changed files)
```

### Performance Tips for Large Codebases

Comment Catcher is optimized to handle large codebases by scanning only from changed files (not the entire codebase). However, if you still encounter issues:

1. **Reduce depth**: Lower the dependency traversal depth (default is 3)
   ```bash
   npm start check -d 1  # Only check immediate dependents
   ```

2. **Skip dependency analysis**: Use `--no-deps` to only analyze changed files (not recommended, as you'll miss outdated comments in dependents)
   ```bash
   npm start check --no-deps
   ```

3. **Increase Node.js memory**: For very large codebases
   ```bash
   NODE_OPTIONS="--max-old-space-size=8192" npm start check
   ```

### Examples

```bash
# Check against main branch
npm start check

# Check against develop branch with deeper dependency analysis
npm start check -b develop -d 5

# Save report to file
npm start check -o report.md

# Generate JSON report
npm start check -f json -o report.json

# Skip dependency analysis for large codebases
npm start check --no-deps

# Reduce depth to avoid memory issues
npm start check -d 1
```

## Configuration (Optional)

**You don't need a config file to get started!** Comment Catcher works out of the box with sensible defaults.

### Defaults

If no config file is found, Comment Catcher uses these defaults:
- **Excludes**: `node_modules`, `dist`, `build`, `.git`
- **Extensions**: `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`
- **Min comment length**: 10 characters
- **Ignored patterns**: `TODO:`, `FIXME:`, `NOTE:`, `HACK:`, `@ts-*`, `eslint-*`, `prettier-*`
- **Model**: `claude-3-5-sonnet-20241022`
- **API endpoint**: `https://api.anthropic.com` (override with `ANTHROPIC_BASE_URL` env var)
- **API key**: from `ANTHROPIC_API_KEY` environment variable

### Custom Configuration

To customize behavior, create a config file in one of these locations:
1. `comment-catcher.config.json`
2. `.comment-catcher.json`
3. `comment-catcher.config.js`

#### Available Options

```json
{
  "excludePatterns": ["node_modules", "dist"],  // Additional patterns to exclude
  "extensions": [".js", ".ts", ".tsx"],         // File extensions to analyze
  "dependencyOptions": {
    "tsConfig": "./tsconfig.json",              // TypeScript config for path resolution
    "webpackConfig": "./webpack.config.js"       // Webpack config for alias resolution
  },
  "commentFilters": {
    "minLength": 10,                            // Minimum comment length to analyze
    "ignorePatterns": ["TODO:", "FIXME:"]       // Comment patterns to skip
  },
  "llmOptions": {
    "model": "claude-3-5-sonnet-20241022",      // Claude model to use
    "baseURL": "https://api.anthropic.com",      // Custom API endpoint
    "apiKeyEnvVar": "ANTHROPIC_API_KEY",         // Env var name for API key
    "baseURLEnvVar": "ANTHROPIC_BASE_URL"       // Env var name for base URL
  }
}
```

See `comment-catcher.config.example.json` for a complete example.

## How It Works

1. **Git Diff**: Identifies files changed compared to the base branch
2. **Dependency Graph**: Uses dependency-cruiser to find related files
   - **Performance optimized**: Scans only the changed files as entry points, not the entire codebase
   - Traverses in both directions up to the specified depth:
     - **Upward**: Files that import the changed files (dependents)
     - **Downward**: Files that the changed files import (dependencies)
3. **Comment Extraction**: Parses TypeScript/JavaScript files to extract all comments
4. **AI Analysis**: Claude analyzes comments against the diff to identify outdated ones
5. **Report**: Generates a report with reasons and suggestions for updating

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev
```

## Exit Codes

- `0`: No outdated comments found
- `1`: Outdated comments found or error occurred

This makes it suitable for use in CI/CD pipelines.

## GitHub Actions Integration

Comment Catcher can automatically check PRs and post feedback as comments.

### Setup

1. **Add the workflow file** to your repository at `.github/workflows/comment-catcher.yml`:

```yaml
name: Comment Catcher

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  check-comments:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Fetch full history for git diff

      - name: Run Comment Catcher
        uses: zachicecreamcohn/comment-catcher@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          base-branch: main  # Optional, defaults to 'main'
          depth: 3  # Optional, defaults to 3
```

2. **Add your Anthropic API key** as a repository secret:
   - Go to your repository Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `ANTHROPIC_API_KEY`
   - Value: Your Anthropic API key

3. **That's it!** The action will now:
   - Run on every PR (opened, updated, or reopened)
   - Analyze comments for outdated documentation
   - Post or update a comment on the PR with results
   - Always provide feedback (even if no issues found)

### Action Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for posting PR comments | Yes | - |
| `anthropic-api-key` | Anthropic API key for Claude AI | Yes | - |
| `base-branch` | Base branch to compare against | No | `main` |
| `depth` | Dependency graph depth to traverse | No | `3` |

### Behavior

- ✅ **Always comments** - Posts feedback even when no issues found
- 🔄 **Updates existing comment** - Keeps PR clean by updating the same comment
- ℹ️ **Informational only** - Never fails the check, only provides suggestions

## Memory Optimization

Comment Catcher is designed to work efficiently with large codebases by using a targeted scanning approach:

- **Only scans changed files as entry points** - Instead of scanning your entire codebase (which could be 10,000+ files), dependency-cruiser only scans the files you actually changed
- **Traverses in both directions from there** - From those changed files, it finds related files up to the depth you specify (default: 3 levels):
  - Files that import the changed files (dependents)
  - Files that the changed files import (dependencies)
- **Low memory cache** - Uses a 100ms cache duration to minimize memory usage

This means if you changed 5 files in a 10,000 file codebase, it will only scan those 5 files plus their related files, not all 10,000 files.
