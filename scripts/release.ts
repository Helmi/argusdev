#!/usr/bin/env bun
/**
 * Interactive release script for ArgusDev
 *
 * Usage:
 *   bun run release              # Interactive mode - prompts for version
 *   bun run release 0.2.0        # Direct mode - releases specified version
 *   bun run release --dry-run    # Preview without making changes
 */

import { execFileSync, spawnSync } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

const packageJsonPath = path.resolve(import.meta.dir, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const currentVersion = packageJson.version;

// Parse arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const versionArg = args.find(arg => !arg.startsWith('--'));

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg: string) {
  console.log(msg);
}

function runGit(...gitArgs: string[]): string {
  try {
    return execFileSync('git', gitArgs, { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

function getCommitsSinceLastTag(): string[] {
  const lastTag = runGit('describe', '--tags', '--abbrev=0');
  if (lastTag) {
    const commits = runGit('log', `${lastTag}..HEAD`, '--oneline');
    return commits.split('\n').filter(Boolean);
  }
  // No tags yet, get recent commits
  const commits = runGit('log', '--oneline', '-20');
  return commits.split('\n').filter(Boolean);
}

function analyzeCommits(commits: string[]): { suggestion: 'major' | 'minor' | 'patch'; reasons: string[] } {
  const reasons: string[] = [];
  let hasFeat = false;
  let hasFix = false;
  let hasBreaking = false;

  for (const commit of commits) {
    const lower = commit.toLowerCase();
    if (lower.includes('breaking') || lower.includes('!:')) {
      hasBreaking = true;
      reasons.push(`Breaking change detected: ${commit.substring(0, 60)}...`);
    } else if (lower.includes('feat:') || lower.includes('feat(')) {
      hasFeat = true;
    } else if (lower.includes('fix:') || lower.includes('fix(')) {
      hasFix = true;
    }
  }

  if (hasBreaking) {
    return { suggestion: 'major', reasons };
  }
  if (hasFeat) {
    reasons.push(`${commits.filter(c => c.toLowerCase().includes('feat')).length} feature commit(s) found`);
    return { suggestion: 'minor', reasons };
  }
  if (hasFix) {
    reasons.push(`${commits.filter(c => c.toLowerCase().includes('fix')).length} fix commit(s) found`);
    return { suggestion: 'patch', reasons };
  }

  reasons.push('No conventional commits found, defaulting to patch');
  return { suggestion: 'patch', reasons };
}

function bumpVersion(version: string, type: 'major' | 'minor' | 'patch'): string {
  const [major, minor, patch] = version.replace(/-.*$/, '').split('.').map(Number);
  switch (type) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
  }
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function isValidSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version);
}

async function main() {
  log(`\n${colors.bold}${colors.cyan}ArgusDev Release${colors.reset}\n`);
  log(`${colors.dim}Current version: ${colors.reset}${colors.yellow}${currentVersion}${colors.reset}`);

  if (dryRun) {
    log(`${colors.dim}Mode: ${colors.reset}${colors.yellow}Dry run${colors.reset}\n`);
  }

  // Get commits and analyze
  const commits = getCommitsSinceLastTag();
  log(`${colors.dim}Commits since last release: ${colors.reset}${commits.length}\n`);

  if (commits.length === 0) {
    log(`${colors.yellow}No commits since last release. Nothing to release.${colors.reset}`);
    process.exit(0);
  }

  // Show recent commits
  log(`${colors.dim}Recent commits:${colors.reset}`);
  commits.slice(0, 5).forEach(c => log(`  ${colors.dim}•${colors.reset} ${c}`));
  if (commits.length > 5) {
    log(`  ${colors.dim}... and ${commits.length - 5} more${colors.reset}`);
  }
  log('');

  // Analyze and suggest
  const { suggestion, reasons } = analyzeCommits(commits);
  const suggestedVersion = bumpVersion(currentVersion, suggestion);

  log(`${colors.dim}Suggested bump: ${colors.reset}${colors.green}${suggestion}${colors.reset} → ${colors.green}${suggestedVersion}${colors.reset}`);
  reasons.forEach(r => log(`  ${colors.dim}• ${r}${colors.reset}`));
  log('');

  // Determine target version
  let targetVersion: string;

  if (versionArg) {
    // Version provided as argument
    if (!isValidSemver(versionArg)) {
      log(`${colors.yellow}Invalid version format: ${versionArg}${colors.reset}`);
      log(`${colors.dim}Expected format: X.Y.Z (e.g., 0.2.0)${colors.reset}`);
      process.exit(1);
    }
    targetVersion = versionArg;
  } else {
    // Interactive mode
    log(`${colors.bold}Enter release version${colors.reset} ${colors.dim}(press Enter for ${suggestedVersion})${colors.reset}:`);
    const input = await prompt(`${colors.cyan}> ${colors.reset}`);

    if (input === '') {
      targetVersion = suggestedVersion;
    } else if (!isValidSemver(input)) {
      log(`${colors.yellow}Invalid version format: ${input}${colors.reset}`);
      process.exit(1);
    } else {
      targetVersion = input;
    }
  }

  log(`\n${colors.bold}Releasing version: ${colors.green}${targetVersion}${colors.reset}\n`);

  // Confirm
  if (!versionArg && !dryRun) {
    const confirm = await prompt(`${colors.yellow}Proceed? (y/N) ${colors.reset}`);
    if (confirm.toLowerCase() !== 'y') {
      log(`${colors.dim}Aborted.${colors.reset}`);
      process.exit(0);
    }
  }

  // Run standard-version using spawnSync for proper output handling
  const standardVersionArgs = ['standard-version', '--release-as', targetVersion];
  if (dryRun) {
    standardVersionArgs.push('--dry-run');
  }

  log(`${colors.dim}Running: npx ${standardVersionArgs.join(' ')}${colors.reset}\n`);

  const result = spawnSync('npx', standardVersionArgs, { stdio: 'inherit' });

  if (result.status === 0) {
    if (!dryRun) {
      log(`\n${colors.green}${colors.bold}Release ${targetVersion} created successfully!${colors.reset}`);
      log(`\n${colors.dim}Next steps:${colors.reset}`);
      log(`  1. Review the changes: ${colors.cyan}git show${colors.reset}`);
      log(`  2. Push with tags: ${colors.cyan}git push --follow-tags${colors.reset}`);
      log(`  3. Update package.json to next dev version (e.g., ${bumpVersion(targetVersion, 'minor')})`);
    }
  } else {
    log(`${colors.yellow}Release failed. See error above.${colors.reset}`);
    process.exit(1);
  }
}

main();
