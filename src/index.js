const core = require('@actions/core');
const github = require('@actions/github');

async function run() {
  try {
    const token = core.getInput('github-token');
    const octokit = github.getOctokit(token);
    const context = github.context;

    // Only run on pull_request events
    if (context.eventName !== 'pull_request') {
      core.warning(`This action only runs on pull_request events, not ${context.eventName}`);
      return;
    }

    const { owner, repo } = context.repo;
    const pullNumber = context.payload.pull_request.number;

    core.info(`Analyzing PR #${pullNumber} in ${owner}/${repo}`);

    // Get PR details
    const { data: pullRequest } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });

    // Get changed files
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
    });

    if (files.length === 0) {
      core.info('No files changed in this PR.');
      return;
    }

    // Analyze files
    const fileExtensions = {};
    const additionsByType = {};
    const deletionsByType = {};
    let totalAdditions = 0;
    let totalDeletions = 0;
    const fileDetails = [];

    for (const file of files) {
      const ext = getExtension(file.filename);
      const status = file.status; // added, modified, removed, renamed, copied, changed

      fileExtensions[ext] = (fileExtensions[ext] || 0) + 1;
      additionsByType[ext] = (additionsByType[ext] || 0) + file.additions;
      deletionsByType[ext] = (deletionsByType[ext] || 0) + file.deletions;
      totalAdditions += file.additions;
      totalDeletions += file.deletions;

      fileDetails.push({
        filename: file.filename,
        status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch || '',
      });
    }

    // Risk assessment
    const risks = assessRisks(files);

    // Generate structured summary
    const summary = generateSummary(
      pullRequest,
      files,
      fileExtensions,
      fileDetails,
      totalAdditions,
      totalDeletions,
      risks
    );

    // Post comment to PR
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: summary,
    });

    core.info(`Successfully posted PR summary comment to #${pullNumber}`);

    // Set outputs for downstream actions
    core.setOutput('total-files', files.length);
    core.setOutput('total-additions', totalAdditions);
    core.setOutput('total-deletions', totalDeletions);
    core.setOutput('comment-posted', 'true');
    core.setOutput('risk-level', risks.level);

  } catch (error) {
    core.setFailed(`PR Summarizer failed: ${error.message}`);
  }
}

function getExtension(filename) {
  const parts = filename.split('.');
  if (parts.length > 1) {
    return parts[parts.length - 1].toLowerCase();
  }
  return '(no extension)';
}

function assessRisks(files) {
  const highRiskPatterns = [
    /package-lock\.json$/,
    /yarn\.lock$/,
    /Gemfile\.lock$/,
    /^\.env/,
    /^\.gitignore/,
    /^\.github\/workflows\//,
    /^docker-compose/,
    /^Dockerfile$/,
    /^Makefile$/,
    /^webpack\.config/,
    /vite\.config/,
    /^\.eslintrc/,
    /^tsconfig\.json$/,
    /^database\//,
    /^migrations\//,
    /^db\//,
    /^seeds\//,
    /^prisma\//,
    /^.*password.*/i,
    /^.*secret.*/i,
    /^.*token.*/i,
    /^.*credential.*/i,
    /^.*apikey.*/i,
    /^.*apikey.*/i,
  ];

  const mediumRiskPatterns = [
    /\/tests?\//,
    /\/__tests__\//,
    /\.spec\./,
    /\.test\./,
    /^.*\.config\.(js|ts|json)$/,
    /^\.editorconfig$/,
    /^\.prettierrc/,
    /^\.stylelintrc/,
    /README\.md$/,
    /^CHANGELOG/,
    /^CONTRIBUTING/,
  ];

  let riskScore = 0;
  let highRiskFiles = [];
  let mediumRiskFiles = [];
  const warnings = [];

  for (const file of files) {
    for (const pattern of highRiskPatterns) {
      if (pattern.test(file.filename)) {
        riskScore += 3;
        highRiskFiles.push(file.filename);
        break;
      }
    }
  }

  for (const file of files) {
    for (const pattern of mediumRiskPatterns) {
      if (pattern.test(file.filename)) {
        riskScore += 1;
        mediumRiskFiles.push(file.filename);
        break;
      }
    }
  }

  // Check for large changes
  for (const file of files) {
    if (file.changes > 500) {
      warnings.push(`🔴 File \`${file.filename}\` has ${file.changes} changes — consider splitting into smaller PRs.`);
      riskScore += 2;
    } else if (file.changes > 200) {
      warnings.push(`🟡 File \`${file.filename}\` has ${file.changes} changes — review carefully.`);
      riskScore += 1;
    }
  }

  // Check for binary files
  for (const file of files) {
    if (file.status === 'added' && !file.patch && file.changes > 0) {
      warnings.push(`🟠 File \`${file.filename}\` appears to be a binary/large file addition (no diff available).`);
      riskScore += 1;
    }
  }

  let level;
  if (riskScore >= 5) {
    level = 'high';
  } else if (riskScore >= 2) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { level, score: riskScore, warnings, highRiskFiles, mediumRiskFiles };
}

function generateSummary(pr, files, fileExtensions, fileDetails, totalAdditions, totalDeletions, risks) {
  const lines = [];

  // Header
  lines.push(`## 🤖 PR Summary — #${pr.number}`);
  lines.push('');
  lines.push(`**${pr.title}**`);
  lines.push('');
  lines.push(`> ${pr.body ? pr.body.split('\n')[0].substring(0, 200) : '(No description provided)'}`);
  lines.push('');

  // Overview section
  lines.push('### 📊 Overview');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| **Changed files** | ${files.length} |`);
  lines.push(`| **Additions** | +${totalAdditions} |`);
  lines.push(`| **Deletions** | -${totalDeletions} |`);
  lines.push(`| **Total changes** | ${totalAdditions + totalDeletions} |`);

  // Branch info
  lines.push(`| **Branch** | \`${pr.head.ref}\` → \`${pr.base.ref}\` |`);
  lines.push('');

  // File type breakdown
  lines.push('### 📁 Files by Type');
  lines.push('');
  const sortedExtensions = Object.entries(fileExtensions).sort((a, b) => b[1] - a[1]);

  // Group into a readable format
  const extLabels = {
    js: 'JavaScript', jsx: 'React JSX', ts: 'TypeScript', tsx: 'React TSX',
    py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java',
    md: 'Markdown', json: 'JSON', yml: 'YAML', yaml: 'YAML',
    css: 'CSS', scss: 'SCSS', less: 'Less', html: 'HTML',
    vue: 'Vue', svelte: 'Svelte', graphql: 'GraphQL', sql: 'SQL',
    sh: 'Shell', bash: 'Bash', dockerfile: 'Dockerfile',
    txt: 'Text', xml: 'XML', toml: 'TOML', cfg: 'Config',
    lock: 'Lockfile', gitignore: 'Gitignore',
  };

  for (const [ext, count] of sortedExtensions) {
    const label = extLabels[ext] || ext.toUpperCase();
    const adds = additionsByType[ext] || 0;
    const dels = deletionsByType[ext] || 0;
    const addStr = adds > 0 ? `+${adds}` : '';
    const delStr = dels > 0 ? `-${dels}` : '';
    const changeStr = [addStr, delStr].filter(Boolean).join(' / ');
    lines.push(`- **${label}** (${count} file${count > 1 ? 's' : ''}) — ${changeStr}`);
  }
  lines.push('');

  // Detailed changed files
  lines.push('### 📄 Changed Files');
  lines.push('');
  lines.push('| File | Status | Changes |');
  lines.push('|------|--------|---------|');

  for (const file of fileDetails) {
    const statusIcon = file.status === 'added' ? '✅ Added' :
      file.status === 'removed' ? '❌ Removed' :
      file.status === 'renamed' ? '🔄 Renamed' :
      file.status === 'modified' ? '✏️ Modified' : file.status;
    const changes = `+${file.additions}/-${file.deletions}`;
    lines.push(`| \`${file.filename}\` | ${statusIcon} | ${changes} |`);
  }
  lines.push('');

  // Risk assessment
  lines.push('### ⚠️ Risk Assessment');
  lines.push('');
  const riskEmoji = risks.level === 'high' ? '🔴' : risks.level === 'medium' ? '🟡' : '🟢';
  lines.push(`**Risk Level:** ${riskEmoji} **${risks.level.toUpperCase()}** (score: ${risks.score})`);
  lines.push('');

  if (risks.warnings.length > 0) {
    lines.push('**Warnings:**');
    for (const warning of risks.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  if (risks.highRiskFiles.length > 0) {
    lines.push('**🔴 High-sensitivity files changed:**');
    for (const f of risks.highRiskFiles) {
      lines.push(`- \`${f}\``);
    }
    lines.push('');
  }

  // Test suggestions
  lines.push('### 🧪 Testing Suggestions');
  lines.push('');

  const testableTypes = ['.js', '.ts', '.py', '.rb', '.go', '.rs', '.java', '.jsx', '.tsx', '.vue', '.svelte'];
  const sourceFiles = files.filter(f => testableTypes.some(ext => f.filename.endsWith(ext)));
  const configFiles = files.filter(f => /\.(yml|yaml|json|toml|cfg|env)/.test(f.filename));
  const testFiles = files.filter(f => /\.(spec|test)\./.test(f.filename) || /\/tests?\//.test(f.filename));
  const dbFiles = files.filter(f => /(migration|schema|seed|database|db|prisma)/i.test(f.filename));
  const infraFiles = files.filter(f => /(Dockerfile|docker-compose|\.github\/workflows|Makefile|webpack|vite)/.test(f.filename));

  if (testFiles.length === 0 && sourceFiles.length > 0) {
    lines.push('- 🧪 No test files detected in this PR — consider adding tests for the changed logic.');
  }
  if (testFiles.length > 0) {
    lines.push('- ✅ Test files found — ensure all tests pass before merging.');
  }
  if (configFiles.length > 0) {
    lines.push('- ⚙️ Configuration files changed — verify correctness and impact on other environments.');
  }
  if (dbFiles.length > 0) {
    lines.push('- 🗄️ Database-related files changed — verify migrations are reversible and schema changes are backward-compatible.');
  }
  if (infraFiles.length > 0) {
    lines.push('- 🏗️ Infrastructure/config files changed — review deployment impact carefully.');
  }
  if (totalDeletions > totalAdditions * 1.5 && totalDeletions > 100) {
    lines.push('- 🧹 Significant deletions — verify no required functionality was removed.');
  }
  if (totalAdditions > 1000) {
    lines.push('- 📦 Large PR detected — consider splitting into smaller, focused PRs for easier review.');
  }
  lines.push('- 🔍 Manually verify the most critical changes before merging.');
  lines.push('');

  // Footer
  lines.push('---');
  lines.push(`*🤖 Generated by [PR Summarizer](https://github.com/wsgcjj/pr-summarizer) action*`);

  return lines.join('\n');
}

run();
