#!/usr/bin/env node

import { Command } from "commander";
import { exportList, formatListOutput } from "./export.js";
import { getTaskLists } from "./graph.js";

const program = new Command();

program
  .name("todo")
  .description("CLI for Microsoft To-Do")
  .version("1.0.0");

program
  .command("export")
  .description("Export a Microsoft To-Do task list to Markdown")
  .requiredOption("-l, --list <identifier>", "Task list ID or name (partial, case-insensitive)")
  .option("-o, --out <path>", "Output Markdown file path (defaults to <list-name>.md)")
  .option("--ordering-source <path>", "File from To-Do 'Share copy' to set task order")
  .action(async (opts: { list: string; out?: string; orderingSource?: string }) => {
    try {
      await exportList(opts.list, opts.out, opts.orderingSource);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exit(1);
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
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });

program.parse();
