# n8n workflow JSON checker (catches n8n import errors)

A small script that checks an n8n workflow JSON file for the mistakes that break it after import: broken connections, missing trigger, references to nodes that do not exist, and API keys pasted into the file. Useful when a workflow was written or edited by an AI assistant, or by hand.

Independent project. Not affiliated with or endorsed by n8n.

## What it catches

- A connection that points at a node that does not exist (usually after a rename)
- An expression such as `$('Fetch data')` that names a node that does not exist
- No trigger node
- Two nodes with the same name
- Missing `type`, `typeVersion`, `position` or `parameters` on a node
- API keys and tokens pasted into the file
- Warnings for nodes that nothing connects to, and for credential ids that will not work on another n8n

It checks structure only. It cannot tell you whether your logic is right, and it does not know each node's individual settings.

## Try it in 30 seconds

This repo includes a deliberately broken workflow. Run:

```bash
node scripts/validate-workflow.mjs examples/broken-example.json
```

You should see:

```
FAIL examples/broken-example.json
  error:   "Get users" connects to "Format", which does not exist.
```

## Use it

Needs Node.js 18 or newer. No install, no dependencies.

```bash
node scripts/validate-workflow.mjs workflows/01-fetch-and-reshape.json
```

You should see `OK`. Point it at your own files the same way; you can pass several at once. It exits with code 1 when any file has an error, so it also works in CI.

To get a workflow file out of n8n: open the workflow, three-dot menu, **Download**.

Run the checker's own tests with:

```bash
node --test
```

## Two example workflows

Both run without any account or API key. Import them in n8n with the three-dot menu, **Import from file**, then click **Execute workflow**.

- `workflows/01-fetch-and-reshape.json`: call an API, keep some fields, filter, sort.
- `workflows/04-clean-and-dedupe.json`: tidy a messy contact list and remove duplicates.

Both were run on n8n 2.47.5.

## Want Claude Code to write the workflows for you?

The full kit adds a Claude Code skill with tested n8n node settings, project rules that make Claude Code check its own work, and three more examples (webhook intake, scheduled digest, retry with a failure branch). It does not include app-specific nodes such as Google Sheets or Slack.

**n8n Workflow Kit for Claude Code:** https://cellside.gumroad.com/l/n8n-workflow-kit
