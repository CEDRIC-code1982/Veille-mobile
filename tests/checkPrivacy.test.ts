import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const TSX_BINARY = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const SCRIPT_PATH = join(REPO_ROOT, 'src', 'tools', 'checkPrivacy.ts');

const SECRET_TERM = 'ExampleEmployer';

interface ScanResult {
  status: number | null;
  output: string;
}

const buildEnvironment = (extra: Record<string, string>): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  delete environment.FORBIDDEN_TERMS;

  return { ...environment, ...extra };
};

const runGitIn = (cwd: string, args: string[]): void => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
};

const runScan = (
  cwd: string,
  args: string[] = [],
  extraEnvironment: Record<string, string> = {},
): ScanResult => {
  const result = spawnSync(TSX_BINARY, [SCRIPT_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: buildEnvironment(extraEnvironment),
  });

  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

describe('checkPrivacy', () => {
  let repositoryPath = '';

  beforeEach(() => {
    repositoryPath = mkdtempSync(join(tmpdir(), 'veille-privacy-'));
    runGitIn(repositoryPath, ['init', '-q', '-b', 'main']);
    runGitIn(repositoryPath, ['config', 'user.email', 'test@example.invalid']);
    runGitIn(repositoryPath, ['config', 'user.name', 'Test Runner']);
    // Mirrors the real repository: the term list is never scannable content.
    writeFileSync(join(repositoryPath, '.gitignore'), 'forbidden-terms.local.txt\n', 'utf8');
  });

  afterEach(() => {
    rmSync(repositoryPath, { recursive: true, force: true });
  });

  const writeTermsFile = (): void => {
    writeFileSync(
      join(repositoryPath, 'forbidden-terms.local.txt'),
      `# comment\n${SECRET_TERM}\n`,
      'utf8',
    );
  };

  it('fails on a forbidden term found in an indexed file', () => {
    writeTermsFile();
    writeFileSync(join(repositoryPath, 'notes.md'), 'Written for example-employer\n', 'utf8');
    runGitIn(repositoryPath, ['add', 'notes.md']);

    const result = runScan(repositoryPath);

    expect(result.status).toBe(1);
    expect(result.output).toContain('forbidden term #1 found at notes.md:1');
    expect(result.output).toContain('privacy scan failed with 1 violation(s)');
  });

  it('never echoes the forbidden term itself, because this output is public', () => {
    writeTermsFile();
    writeFileSync(join(repositoryPath, 'notes.md'), `Mentions ${SECRET_TERM}\n`, 'utf8');
    runGitIn(repositoryPath, ['add', 'notes.md']);

    const result = runScan(repositoryPath);

    expect(result.status).toBe(1);
    expect(result.output.toLowerCase()).not.toContain(SECRET_TERM.toLowerCase());
  });

  it('fails on a forbidden term found only in a commit message', () => {
    writeTermsFile();
    writeFileSync(join(repositoryPath, 'clean.md'), 'nothing to see\n', 'utf8');
    runGitIn(repositoryPath, ['add', 'clean.md']);
    runGitIn(repositoryPath, ['commit', '-q', '--no-verify', '-m', 'chore: sync example_employer']);

    const result = runScan(repositoryPath);

    expect(result.status).toBe(1);
    expect(result.output).toMatch(/forbidden term #1 found at commit [0-9a-f]{12} message:1/);
  });

  it('fails on an untracked file that no ignore rule protects', () => {
    writeTermsFile();
    writeFileSync(join(repositoryPath, 'draft.md'), 'about ExampleEmployer\n', 'utf8');

    expect(runScan(repositoryPath).status).toBe(1);
  });

  it('reads the terms from FORBIDDEN_TERMS when the local file is absent', () => {
    writeFileSync(join(repositoryPath, 'notes.md'), 'about example employer\n', 'utf8');
    runGitIn(repositoryPath, ['add', 'notes.md']);

    const result = runScan(repositoryPath, [], { FORBIDDEN_TERMS: SECRET_TERM });

    expect(result.status).toBe(1);
    expect(result.output).toContain('from $FORBIDDEN_TERMS');
  });

  it('passes on a clean repository', () => {
    writeTermsFile();
    writeFileSync(join(repositoryPath, 'notes.md'), 'Android behaviour changes\n', 'utf8');
    runGitIn(repositoryPath, ['add', 'notes.md']);
    runGitIn(repositoryPath, ['commit', '-q', '--no-verify', '-m', 'feat: add notes']);

    const result = runScan(repositoryPath);

    expect(result.status).toBe(0);
    expect(result.output).toContain('privacy scan passed');
  });

  it('warns but passes when no term is configured, and fails under --require-terms', () => {
    const lenient = runScan(repositoryPath);
    expect(lenient.status).toBe(0);
    expect(lenient.output).toContain('no forbidden term configured');

    const strict = runScan(repositoryPath, ['--require-terms']);
    expect(strict.status).toBe(1);
    expect(strict.output).toContain('refused to run without a term list');
  });
});
