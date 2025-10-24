#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
const version = packageJson.version;
const program = new Command();
program
    .name('comment-catcher')
    .description('CLI tool to detect outdated code comments in PRs')
    .version(version);
program
    .command('check')
    .description('Check for outdated comments in the current branch')
    .option('-b, --base <branch>', 'base branch to compare against', 'main')
    .option('-d, --depth <number>', 'dependency graph depth to traverse', '3')
    .option('-o, --output <file>', 'output file for the report')
    .option('-f, --format <format>', 'output format (markdown or json)', 'markdown')
    .option('--no-deps', 'skip dependency analysis (only check changed files)')
    .action(async (options) => {
    try {
        const { getChangedFiles, getDiff } = await import('./core/diff.js');
        const { getDependents } = await import('./core/dependencies.js');
        const { extractComments } = await import('./core/comments.js');
        const { analyzeComments } = await import('./core/analyzer.js');
        const { generateReport } = await import('./core/report.js');
        const fs = await import('fs/promises');
        console.log('🔍 Checking for outdated comments...\n');
        // Step 1: Get changed files
        console.log(`📝 Getting changed files compared to ${options.base}...`);
        const changedFiles = await getChangedFiles(options.base);
        console.log(`   Found ${changedFiles.length} changed file(s)\n`);
        if (changedFiles.length === 0) {
            console.log('✅ No changed files found. Nothing to analyze.');
            return;
        }
        // Step 2: Get related files (dependents + dependencies, if enabled)
        let relatedFiles = [];
        if (options.deps !== false) {
            console.log(`🔗 Finding related files (depth: ${options.depth})...`);
            console.log(`   Scanning from changed files only (not entire codebase)`);
            relatedFiles = await getDependents(changedFiles, parseInt(options.depth));
            console.log(`   Found ${relatedFiles.length} related file(s) (dependents + dependencies)\n`);
        }
        else {
            console.log('⏭️  Skipping dependency analysis (--no-deps flag)\n');
        }
        // Step 3: Extract comments from changed files and related files
        const allFiles = [...changedFiles, ...relatedFiles];
        console.log(`💬 Extracting comments from ${allFiles.length} file(s)...`);
        const comments = await extractComments(allFiles);
        console.log(`   Found ${comments.length} comment(s)\n`);
        if (comments.length === 0) {
            console.log('✅ No comments found. Nothing to analyze.');
            return;
        }
        // Step 4: Get diff
        console.log('📊 Getting git diff...');
        const diff = await getDiff(options.base);
        // Step 5: Analyze with LLM
        console.log('🤖 Analyzing comments with Claude...');
        const outdatedComments = await analyzeComments(comments, diff);
        console.log(`   Found ${outdatedComments.length} potentially outdated comment(s)\n`);
        // Step 6: Generate report
        const format = options.format === 'json' ? 'json' : 'markdown';
        const report = generateReport(outdatedComments, format);
        if (options.output) {
            await fs.writeFile(options.output, report, 'utf-8');
            console.log(`📄 Report saved to ${options.output}`);
        }
        else {
            console.log('📄 Report:\n');
            console.log(report);
        }
        if (outdatedComments.length > 0) {
            process.exit(1); // Exit with error code if outdated comments found
        }
    }
    catch (error) {
        console.error('❌ Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
});
program.parse();
//# sourceMappingURL=cli.js.map