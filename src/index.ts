#!/usr/bin/env node

import { Command } from "commander";
import { exportList, exportAllLists, formatListOutput, type InlineLinkMode, type CompletedAttachmentsMode } from "./export.js";
import { getTaskLists } from "./graph.js";
import { setAccount } from "./auth.js";

const program = new Command();

program
  .name("todo")
  .description("CLI for Microsoft To-Do")
  .version("1.0.0")
  .option("--verbose", "Show detailed output and full error information")
  .option("--account <nickname>", "Account to use; 'default' (or omitted) uses the standard token cache, any other nickname uses a separate cache", "default")
  .hook("preAction", (thisCommand) => {
    setAccount(thisCommand.opts().account as string | undefined);
  });

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
  .description("Export a Microsoft To-Do task list (or all lists) to Markdown")
  .argument("[list]", "Task list ID or name (partial, case-insensitive); omit when using --all")
  .option("--all", "Export every task list in the account")
  .option("-o, --out <path>", "Output Markdown file path (or directory, with --all); defaults to <list-name>.md (or current directory with --all)")
  .option("-m, --metadata", "Include task metadata in Obsidian Tasks emoji format")
  .option("-a, --attachments [path]", "Download and include task attachments (optional: attachment folder path)")
  .option("-c, --completed-attachments <mode>", "How to handle attachments on completed tasks: default|skip|subfolder (default: default)")
  .option("--inline-link <mode>", "Inline linked resource in task title: auto|always|never (default: auto)")
  .option("--ordering-source <path>", "File or directory from To-Do 'Send a copy' to set task order (directory is searched for <list>.md/.txt, with emoji-prefix fallback; required to be a directory with --all)")
  .action(async (list: string | undefined, opts: { all?: boolean; out?: string; metadata?: boolean; attachments?: boolean | string; completedAttachments?: string; inlineLink?: string; orderingSource?: string }) => {
    try {
      const attachPath = typeof opts.attachments === "string" ? opts.attachments : undefined;
      const inlineLink = (opts.inlineLink ?? "auto") as InlineLinkMode;
      if (!["auto", "always", "never"].includes(inlineLink)) {
        console.error(`Error: --inline-link must be auto, always, or never (got "${inlineLink}")`);
        process.exit(1);
      }
      const completedAttachments = (opts.completedAttachments ?? "default") as CompletedAttachmentsMode;
      if (!["default", "skip", "subfolder"].includes(completedAttachments)) {
        console.error(`Error: --completed-attachments must be default, skip, or subfolder (got "${completedAttachments}")`);
        process.exit(1);
      }
      if (opts.all) {
        if (list) {
          console.error("Error: cannot specify a list argument together with --all");
          process.exit(1);
        }
        await exportAllLists(opts.out, opts.orderingSource, opts.metadata, !!opts.attachments, attachPath, inlineLink, completedAttachments);
      } else {
        if (!list) {
          console.error("Error: missing required list argument (or use --all to export every list)");
          process.exit(1);
        }
        await exportList(list, opts.out, opts.orderingSource, opts.metadata, !!opts.attachments, attachPath, inlineLink, completedAttachments);
      }
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
      console.log(formatListOutput(lists, opts.verbose));
    } catch (err: unknown) {
      handleError(err);
    }
  });

program.parse();
