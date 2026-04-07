#!/usr/bin/env node

import { Command } from "commander";
import { exportList } from "./export.js";

const program = new Command();

program
  .name("todo")
  .description("CLI for Microsoft To-Do")
  .version("1.0.0");

program
  .command("export")
  .description("Export a Microsoft To-Do task list to Markdown")
  .requiredOption("--list <identifier>", "Task list ID or name (partial, case-insensitive)")
  .requiredOption("--out <path>", "Output Markdown file path")
  .action(async (opts: { list: string; out: string }) => {
    try {
      await exportList(opts.list, opts.out);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });

program.parse();
