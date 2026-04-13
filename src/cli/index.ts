#!/usr/bin/env bun
// opensober — CLI entry.
//
// This file is a thin Commander router; subcommand logic lives in sibling files
// so they can be tested without spawning subprocesses.
//
// The shebang above is preserved by `bun build` so the compiled dist/cli/index.js
// is directly executable; `npm install` chmods the bin target automatically.

import { Command } from "commander"
import { NAME, VERSION } from "../index"
import { doctorCommand } from "./doctor"
import { runCommand } from "./run"

const program = new Command()

program.name(NAME).description("An opencode plugin that doesn't try to be clever.").version(VERSION)

program
  .command("doctor")
  .description("run health diagnostics against the current opensober configuration")
  .option("--cwd <path>", "directory to start config discovery from", process.cwd())
  .option("--config <path>", "path to a config file to use as the highest-priority layer")
  .action((opts: { cwd: string; config?: string }) => {
    process.exitCode = doctorCommand({
      cwd: opts.cwd,
      configOverride: opts.config,
    })
  })

program
  .command("install")
  .description("interactively configure opensober for the current project")
  .action(() => {
    console.log("opensober install: not yet implemented")
    process.exitCode = 1
  })

program
  .command("run")
  .description("load and inspect the current opensober config")
  .option("--cwd <path>", "directory to start config discovery from", process.cwd())
  .option("--config <path>", "path to a config file to use as the highest-priority layer")
  .action((opts: { cwd: string; config?: string }) => {
    process.exitCode = runCommand({
      cwd: opts.cwd,
      configOverride: opts.config,
    })
  })

program.parseAsync(process.argv)
