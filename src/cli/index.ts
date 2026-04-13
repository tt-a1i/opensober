#!/usr/bin/env bun
// opensober — CLI entry.
//
// Subcommands (install / doctor / run / refresh-model-capabilities) land in later steps.
// This stub wires Commander up so `bunx opensober --help` works the moment we publish.
//
// The shebang above is preserved by `bun build` so the compiled dist/cli/index.js is
// directly executable; `npm install` chmods the bin target automatically.

import { Command } from "commander"
import { NAME, VERSION } from "../index"

const program = new Command()

program.name(NAME).description("An opencode plugin that doesn't try to be clever.").version(VERSION)

program
  .command("doctor")
  .description("run health diagnostics against the current environment")
  .action(() => {
    console.log("opensober doctor: not yet implemented")
    process.exitCode = 1
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
  .description("start a non-interactive opencode session")
  .action(() => {
    console.log("opensober run: not yet implemented")
    process.exitCode = 1
  })

program.parseAsync(process.argv)
