/**
 * Turns vitest's JSON report into a GitHub Actions job summary.
 *
 * Reads ./unit-test-results.json (run from ./backend), writes a markdown report to
 * $GITHUB_STEP_SUMMARY, echoes each failure to the step log, and emits a ::error::
 * annotation per failing test so it surfaces in the run UI.
 *
 * Always exits 0 — reporting only. The check gate is a separate step.
 */
const fs = require('fs');

const RESULTS_PATH = 'unit-test-results.json';
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
const lines = [];
const w = (line = '') => lines.push(line);

const flush = () => {
    const text = lines.join('\n') + '\n';
    if (summaryPath) fs.appendFileSync(summaryPath, text);
    else process.stdout.write(text);
};

const escapeHtml = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

if (!fs.existsSync(RESULTS_PATH)) {
    w('## Unit tests — no report produced');
    w('');
    w('`' + RESULTS_PATH + '` was never written, so vitest crashed before any test ran.');
    w('Check the "Run unit tests" step log above.');
    flush();
    process.exit(0);
}

const report = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
const total = report.numTotalTests;
const passed = report.numPassedTests;
const failed = report.numFailedTests;
const skipped = (report.numPendingTests || 0) + (report.numTodoTests || 0);

const repoRoot = process.cwd().replace(/\\/g, '/');
const rel = (p) => p.replace(/\\/g, '/').replace(repoRoot + '/', '');

w(`## ${failed > 0 ? '❌' : '✅'} Unit tests — ${passed}/${total} passed`);
w('');
w('| Passed | Failed | Skipped |');
w('| ---: | ---: | ---: |');
w(`| ${passed} | ${failed} | ${skipped} |`);
w('');

w('### Files');
w('');
w('| | File | Passed | Failed |');
w('| :-: | --- | ---: | ---: |');
for (const file of report.testResults) {
    const failedCount = file.assertionResults.filter((a) => a.status === 'failed').length;
    const passedCount = file.assertionResults.filter((a) => a.status === 'passed').length;
    w(`| ${failedCount > 0 ? '❌' : '✅'} | \`${rel(file.name)}\` | ${passedCount} | ${failedCount} |`);
}
w('');

if (failed > 0) {
    w('### Failing tests');
    w('');
    for (const file of report.testResults) {
        const failures = file.assertionResults.filter((a) => a.status === 'failed');
        if (failures.length === 0) continue;

        const filePath = rel(file.name);
        w(`#### \`${filePath}\``);
        w('');

        for (const assertion of failures) {
            const name = [...(assertion.ancestorTitles || []), assertion.title]
                .filter(Boolean)
                .join(' > ');
            const message = (assertion.failureMessages || []).join('\n\n').trim() || '(no message)';
            const headline = message.split('\n')[0];
            const body = message.split('\n').slice(0, 40).join('\n').replace(/```/g, "'''");

            w(`<details><summary><strong>${escapeHtml(name)}</strong> — ${escapeHtml(headline)}</summary>`);
            w('');
            w('```');
            w(body);
            w('```');
            w('</details>');
            w('');

            console.log(`FAIL  ${filePath}`);
            console.log(`      ${name}`);
            for (const l of message.split('\n').slice(0, 12)) console.log(`      ${l}`);
            console.log('');

            const annotation = message.split('\n').slice(0, 8).join('%0A').replace(/\r/g, '');
            console.log(`::error file=${filePath},title=${name.replace(/[\r\n]/g, ' ')}::${annotation}`);
        }
    }
}

flush();
