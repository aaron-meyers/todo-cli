#!/usr/bin/env node

import { Command } from "commander";
import { exportList, formatListOutput, type InlineLinkMode } from "./export.js";
import { getTaskLists } from "./graph.js";

const program = new Command();

program
  .name("todo")
  .description("CLI for Microsoft To-Do")
  .version("1.0.0")
  .option("--verbose", "Show detailed output and full error information");

function isVerbose(): boolean {
  return program.opts().verbose === true;
}

function handleError(err: unknown): never {
  if (isVerbose() && err instanceof Error) {
    console.error(`Error: ${err.message}`);
    // Graph SDK errors often have useful properties
    const graphErr = err as unknown as Record<string, unknown>;
    if (graphErr.statusCode) console.error(`  Status code: ${graphErr.statusCode}`);
    if (graphErr.code) console.error(`  Code: ${graphErr.code}`);
    if (graphErr.requestId) console.error(`  Request ID: ${graphErr.requestId}`);
    if (graphErr.body) {
      try {
        const body = typeof graphErr.body === "string" ? JSON.parse(graphErr.body) : graphErr.body;
        console.error(`  Response body: ${JSON.stringify(body, null, 2)}`);
      } catch {
        console.error(`  Response body: ${graphErr.body}`);
      }
    }
    console.error(`\nStack trace:\n${err.stack}`);
  } else {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
  }
  process.exit(1);
}

program
  .command("export")
  .description("Export a Microsoft To-Do task list to Markdown")
  .requiredOption("-l, --list <identifier>", "Task list ID or name (partial, case-insensitive)")
  .option("-o, --out <path>", "Output Markdown file path (defaults to <list-name>.md)")
  .option("-m, --metadata", "Include task metadata in Obsidian Tasks emoji format")
  .option("-a, --attachments [path]", "Download and include task attachments (optional: attachment folder path)")
  .option("--inline-link <mode>", "Inline linked resource in task title: auto|always|never (default: auto)")
  .option("--ordering-source <path>", "File from To-Do 'Send a copy' to set task order")
  .action(async (opts: { list: string; out?: string; metadata?: boolean; attachments?: boolean | string; inlineLink?: string; orderingSource?: string }) => {
    try {
      const attachPath = typeof opts.attachments === "string" ? opts.attachments : undefined;
      const inlineLink = (opts.inlineLink ?? "auto") as InlineLinkMode;
      if (!["auto", "always", "never"].includes(inlineLink)) {
        console.error(`Error: --inline-link must be auto, always, or never (got "${inlineLink}")`);
        process.exit(1);
      }
      await exportList(opts.list, opts.out, opts.orderingSource, opts.metadata, !!opts.attachments, attachPath, inlineLink);
    } catch (err: unknown) {
      handleError(err);
    }
  });

program
  .command("list")
  .description("List all Microsoft To-Do task lists")
  .option("-v, --verbose", "Show list IDs")
  .action(async (opts: { verbose?: boolean }) => {
    try {
      const lists = await getTaskLists();
      console.error(formatListOutput(lists, opts.verbose));
    } catch (err: unknown) {
      handleError(err);
    }
  });

program.parse();
