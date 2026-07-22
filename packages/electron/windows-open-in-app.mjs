import fs from 'node:fs';
import path from 'node:path';

export const resolveWindowsScriptExecutable = (scriptPath) => {
  if (!scriptPath || !/\.(?:cmd|bat)$/i.test(scriptPath)) return null;
  let source = '';
  try {
    source = fs.readFileSync(scriptPath, 'utf8');
  } catch {
    return null;
  }
  const scriptDir = path.dirname(scriptPath);
  const matches = [...source.matchAll(/(?:(?:%~dp0|%~dp0\\|%~dp0\/|\.\.\\|\.\.\/|[A-Za-z]:\\|[A-Za-z]:\/)[^"'\r\n]*?\.exe)/gi)];
  for (const match of matches) {
    const raw = String(match[0] || '').replace(/^%~dp0[\\/]?/i, '').trim();
    const candidate = path.isAbsolute(raw) ? raw : path.resolve(scriptDir, raw);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

export const resolveVsCodeExecutableFromShim = (scriptPath) => {
  if (path.basename(scriptPath || '').toLowerCase() !== 'code.cmd') return null;
  let source = '';
  try {
    source = fs.readFileSync(scriptPath, 'utf8');
  } catch {
    return null;
  }
  const launchesCode = source
    .split(/\r?\n/)
    .some((line) => /^"%~dp0\.\.[\\/]Code\.exe"(?:\s|$)/i.test(line.trim()));
  if (!launchesCode) return null;

  const executablePath = path.resolve(path.dirname(scriptPath), '..', 'Code.exe');
  try {
    return fs.statSync(executablePath).isFile() ? executablePath : null;
  } catch {
    return null;
  }
};

export const buildWindowsProjectOpenSpecs = ({
  appId,
  appName,
  targetPath,
  cliByAppId,
  runWhere,
  findExecutable,
  findNamedExecutable,
  resolveScriptExecutable,
}) => {
  const specs = [];
  const addSpec = (program) => {
    if (program && !specs.some((spec) => spec.program === program)) {
      specs.push({ program, args: [targetPath] });
    }
  };

  const cli = cliByAppId[appId];
  if (cli) {
    const resolvedCli = runWhere(cli);
    if (resolvedCli) {
      // Avoid command-shim intermediaries when VS Code requests user-initiated foreground activation.
      if (appId === 'vscode') {
        addSpec(resolveScriptExecutable(resolvedCli));
      }
      addSpec(resolvedCli);
    }
  }

  addSpec(findExecutable(appId));
  addSpec(findNamedExecutable(appName));
  return specs;
};

export const runWindowsSpecChain = async (specs, appName, launchSpec) => {
  const failures = [];
  for (const spec of specs) {
    try {
      await launchSpec(spec);
      return;
    } catch (error) {
      failures.push(`${spec.program}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Failed to open in ${appName}: ${failures.join('; ')}`);
};
