/**
 * Turns a vitest JSON report into a GitHub Actions job summary.
 *
 * Shared by the unit-test and integration-test jobs.
 *
 *   node ../.github/scripts/report-test-results.cjs \
 *     --title "Integration tests" \
 *     --results integration-test-results.json \
 *     --context "Stage: sandbox"
 *
 * Writes markdown to $GITHUB_STEP_SUMMARY, echoes failures to the step log, and emits
 * ::error:: / ::warning:: annotations so they surface in the run UI.
 *
 * Always exits 0 — reporting only. The check gate is a separate step.
 */
const fs = require('fs');

function parseArgs(argv) {
    const args = { title: 'Tests', results: 'test-results.json', context: '' };
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        if (key === '--title') args.title = argv[++i];
        else if (key === '--results') args.results = argv[++i];
        else if (key === '--context') args.context = argv[++i];
    }
    return args;
}

const { title, results: RESULTS_PATH, context } = parseArgs(process.argv.slice(2));

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

const formatDuration = (ms) => {
    if (ms == null) return '-';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
};

if (!fs.existsSync(RESULTS_PATH)) {
    w(`## ${title} — no report produced`);
    w('');
    w('`' + RESULTS_PATH + '` was never written, so vitest crashed before any test ran.');
    w('Check the step log above.');
    flush();
    console.log(`::error::${title}: no report produced - vitest crashed before running.`);
    process.exit(0);
}

const report = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
const total = report.numTotalTests;
const passed = report.numPassedTests;
const failed = report.numFailedTests;
const skipped = (report.numPendingTests || 0) + (report.numTodoTests || 0);
const executed = passed + failed;

const repoRoot = process.cwd().replace(/\\/g, '/');
const rel = (p) => p.replace(/\\/g, '/').replace(repoRoot + '/', '');

const icon = failed > 0 ? '❌' : skipped > 0 && executed === 0 ? '⚠️' : '✅';
w(`## ${icon} ${title} — ${passed}/${total} passed`);
w('');
if (context) {
    w(`_${escapeHtml(context)}_`);
    w('');
}
w('| Passed | Failed | Skipped | Total |');
w('| ---: | ---: | ---: | ---: |');
w(`| ${passed} | ${failed} | ${skipped} | ${total} |`);
w('');

// A suite that skipped everything reports zero failures. Without this it reads as a
// pass, which is how a test suite quietly stops protecting anything.
if (executed === 0 && total > 0) {
    w('> **⚠️ Nothing actually ran.** Every test was skipped, so this result proves nothing.');
    w('');
    console.log(`::warning::${title}: all ${total} tests were skipped - this run verified nothing.`);
} else if (skipped > 0) {
    w(`> **⚠️ ${skipped} test(s) skipped** — see the skipped list below.`);
    w('');
    console.log(`::warning::${title}: ${skipped} of ${total} tests were skipped.`);
}

w('### Files');
w('');
w('| | File | Passed | Failed | Skipped | Duration |');
w('| :-: | --- | ---: | ---: | ---: | ---: |');
for (const file of report.testResults) {
    const counts = { passed: 0, failed: 0, skipped: 0 };
    for (const assertion of file.assertionResults) {
        if (assertion.status === 'passed') counts.passed += 1;
        else if (assertion.status === 'failed') counts.failed += 1;
        else counts.skipped += 1;
    }
    const fileIcon =
        counts.failed > 0 ? '❌' : counts.passed === 0 && counts.skipped > 0 ? '⚠️' : '✅';
    // Compare against null explicitly: startTime is legitimately 0 for a suite that
    // was skipped outright, and a truthiness check would drop the duration.
    const duration =
        file.endTime != null && file.startTime != null
            ? formatDuration(file.endTime - file.startTime)
            : '-';
    w(
        `| ${fileIcon} | \`${rel(file.name)}\` | ${counts.passed} | ${counts.failed} | ${counts.skipped} | ${duration} |`
    );
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
            const message =
                (assertion.failureMessages || []).join('\n\n').trim() || '(no message)';
            const headline = message.split('\n')[0];
            const body = message.split('\n').slice(0, 40).join('\n').replace(/```/g, "'''");

            w(
                `<details><summary><strong>${escapeHtml(name)}</strong> — ${escapeHtml(headline)}</summary>`
            );
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
            console.log(
                `::error file=${filePath},title=${name.replace(/[\r\n]/g, ' ')}::${annotation}`
            );
        }
    }
}

if (skipped > 0) {
    w('### Skipped tests');
    w('');
    for (const file of report.testResults) {
        const skippedAssertions = file.assertionResults.filter(
            (a) => a.status !== 'passed' && a.status !== 'failed'
        );
        if (skippedAssertions.length === 0) continue;

        w(`<details><summary><code>${rel(file.name)}</code> — ${skippedAssertions.length} skipped</summary>`);
        w('');
        for (const assertion of skippedAssertions) {
            const name = [...(assertion.ancestorTitles || []), assertion.title]
                .filter(Boolean)
                .join(' > ');
            w(`- ${escapeHtml(name)}`);
        }
        w('');
        w('</details>');
        w('');
    }
}

flush();
