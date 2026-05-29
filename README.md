# PR Summarizer 🤖

Automatically generate structured summaries for Pull Requests.

When a PR is opened or updated, this action analyzes the changes and posts a comprehensive summary as a comment, including:

- 📊 **Overview** — file count, additions/deletions, branch info
- 📁 **Files by Type** — breakdown grouped by file extension
- 📄 **Changed Files** — per-file status and change counts
- ⚠️ **Risk Assessment** — detects high-risk files, large changes, sensitive configs
- 🧪 **Testing Suggestions** — smart recommendations based on what changed

## Usage

Create a workflow file (e.g., `.github/workflows/pr-summarizer.yml`):

```yaml
name: PR Summarizer

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  summarize:
    runs-on: ubuntu-latest
    steps:
      - uses: cjjgh/pr-summarizer@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for API access | No | `${{ github.token }}` |

## Outputs

| Output | Description |
|--------|-------------|
| `total-files` | Number of files changed in the PR |
| `total-additions` | Total lines added |
| `total-deletions` | Total lines deleted |
| `comment-posted` | Whether the summary comment was posted (`true`/`false`) |
| `risk-level` | Overall risk level (`low`, `medium`, `high`) |

## Example Output

When a PR is created, the action posts a comment like this:

```
## 🤖 PR Summary — #42

**Add user authentication module**

> Implements JWT-based auth with refresh tokens...

### 📊 Overview
| Metric | Value |
|--------|-------|
| Changed files | 12 |
| Additions | +345 |
| Deletions | -28 |

### ⚠️ Risk Assessment
**Risk Level:** 🟡 MEDIUM (score: 4)

**🔴 High-sensitivity files changed:**
- `.env.example`
- `.github/workflows/deploy.yml`
```

## Development

```bash
# Install dependencies
npm install

# Build the action
npm run build
```

## License

MIT
