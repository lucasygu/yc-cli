#!/usr/bin/env node
/**
 * yc — CLI for Y Combinator Startup School
 *
 * Submit weekly updates, track your streak, manage your YC journey
 * from the terminal. Cookie-based auth from your browser session.
 */

import { Command } from "commander";
import kleur from "kleur";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { extractCookies, type CookieSource } from "./lib/cookies.js";
import { YcClient, YcApiError, NotAuthenticatedError, type UpdateInput } from "./lib/client.js";

const program = new Command();

program
  .name("yc")
  .description("CLI for Y Combinator Startup School")
  .version("0.1.0");

// --- Global options ---

function addCookieOption(cmd: Command): Command {
  return cmd
    .option(
      "--cookie-source <browser>",
      "Browser to read cookies from (chrome, safari, firefox)",
      "chrome"
    )
    .option("--chrome-profile <name>", "Chrome profile directory name");
}

function addJsonOption(cmd: Command): Command {
  return cmd.option("--json", "Output raw JSON");
}

async function getClient(cookieSource?: string, chromeProfile?: string): Promise<YcClient> {
  const source = (cookieSource || "chrome") as CookieSource;
  const cookies = await extractCookies(source, chromeProfile);
  return new YcClient(cookies);
}

function handleError(err: unknown): never {
  if (err instanceof NotAuthenticatedError) {
    console.error(kleur.red("Not authenticated."));
    console.error(kleur.dim(err.message));
  } else if (err instanceof YcApiError) {
    console.error(kleur.red(`API error: ${err.message}`));
    if (err.response) {
      console.error(kleur.dim(err.response.slice(0, 300)));
    }
  } else if (err instanceof Error) {
    console.error(kleur.red(err.message));
  } else {
    console.error(kleur.red("Unknown error"));
  }
  process.exit(1);
}

// --- whoami ---

const whoami = program.command("whoami").description("Test connection and show user info");
addCookieOption(whoami);
addJsonOption(whoami);

whoami.action(async (opts) => {
  try {
    const client = await getClient(opts.cookieSource, opts.chromeProfile);
    const user = await client.getCurrentUser();

    if (opts.json) {
      console.log(JSON.stringify(user, null, 2));
      return;
    }

    console.log(kleur.bold(`Hello, ${user.firstName}!`));
    console.log(`  Track:  ${user.track === "active_founder" ? kleur.green("Active Founder") : kleur.yellow("Aspiring Founder")}`);
    console.log(`  Slug:   ${kleur.dim(user.slug)}`);
  } catch (err) {
    handleError(err);
  }
});

// --- dashboard ---

const dashboard = program.command("dashboard").description("Show dashboard — streak, curriculum, weekly status");
addCookieOption(dashboard);
addJsonOption(dashboard);

dashboard.action(async (opts) => {
  try {
    const client = await getClient(opts.cookieSource, opts.chromeProfile);
    const { user, dashboard: dash } = await client.getDashboard();

    if (opts.json) {
      console.log(JSON.stringify({ user, dashboard: dash }, null, 2));
      return;
    }

    console.log(kleur.bold(`Dashboard — ${user.firstName}`));
    console.log();

    // Streak
    const streakColor = dash.currentStreak > 0 ? kleur.green : kleur.dim;
    console.log(`  Streak:     ${streakColor(`${dash.currentStreak} week(s)`)}`);

    // Curriculum
    const pct = Math.round((dash.curriculum.completed / dash.curriculum.required) * 100);
    console.log(`  Curriculum: ${dash.curriculum.completed}/${dash.curriculum.required} (${pct}%)`);
    if (dash.curriculum.nextItem) {
      console.log(`  Next:       ${kleur.cyan(dash.curriculum.nextItem.title)}`);
    }

    // Recent weeks
    console.log();
    console.log(kleur.bold("  Recent Updates:"));
    const recentWeeks = dash.updatesByWeek.slice(0, 4);
    for (const week of recentWeeks) {
      const status = week.url ? kleur.green("submitted") : kleur.red("missing");
      console.log(`    ${week.weekLabel}  ${status}`);
    }
  } catch (err) {
    handleError(err);
  }
});

// --- updates ---

const updates = program
  .command("updates")
  .description("List weekly updates");
addCookieOption(updates);
addJsonOption(updates);

updates.action(async (opts) => {
  try {
    const client = await getClient(opts.cookieSource, opts.chromeProfile);
    const result = await client.getUpdates();

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(kleur.bold(`${result.companyName} — Weekly Updates`));
    console.log(
      `  This week: ${result.thisWeekSubmitted ? kleur.green("submitted") : kleur.red("not submitted")}`
    );
    console.log();

    for (const update of result.updates) {
      const moraleBar = "█".repeat(update.morale) + "░".repeat(10 - update.morale);
      console.log(
        `  ${kleur.bold(update.formattedDate)}  ${kleur.dim(`[${update.id}]`)}`
      );
      console.log(
        `    ${update.metricDisplayName}: ${kleur.cyan(String(update.metricValue))}  ` +
          `Morale: ${moraleBar} ${update.morale}/10  ` +
          `Talked to: ${update.talkedTo}`
      );
      if (update.biggestChange) {
        console.log(`    Change: ${kleur.dim(update.biggestChange.slice(0, 80))}`);
      }
      if (update.biggestBlocker) {
        console.log(`    Blocker: ${kleur.dim(update.biggestBlocker.slice(0, 80))}`);
      }
      console.log();
    }
  } catch (err) {
    handleError(err);
  }
});

// --- updates show ---

const updatesShow = program
  .command("show <id>")
  .description("Show a single update");
addCookieOption(updatesShow);
addJsonOption(updatesShow);

updatesShow.action(async (id, opts) => {
  try {
    const client = await getClient(opts.cookieSource, opts.chromeProfile);
    const result = await client.getUpdates();
    const update = result.updates.find((u) => u.id === id);

    if (!update) {
      console.error(kleur.red(`Update "${id}" not found.`));
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(update, null, 2));
      return;
    }

    console.log(kleur.bold(update.formattedDate));
    console.log(`  ${update.metricDisplayName}: ${update.metricValue}`);
    console.log(`  Morale: ${update.morale}/10`);
    console.log(`  Users talked to: ${update.talkedTo}`);
    if (update.learnedFromUsers) {
      console.log(`  Learned: ${update.learnedFromUsers}`);
    }
    if (update.biggestChange) {
      console.log(`  Biggest change: ${update.biggestChange}`);
    }
    if (update.biggestBlocker) {
      console.log(`  Biggest blocker: ${update.biggestBlocker}`);
    }
    if (update.completableGoals && update.completableGoals.length > 0) {
      console.log(`  Goals:`);
      for (const g of update.completableGoals) {
        const check = g.completed ? kleur.green("x") : " ";
        console.log(`    [${check}] ${g.goal}`);
      }
    }
  } catch (err) {
    handleError(err);
  }
});

// --- updates new ---

const updatesNew = program
  .command("new")
  .description("Submit a new weekly update")
  .option("--metric <value>", "Primary metric value (number)")
  .option("--morale <value>", "Morale 1-10")
  .option("--talked-to <value>", "Users talked to (number)")
  .option("--change <text>", "What most improved your metric")
  .option("--blocker <text>", "Biggest obstacle")
  .option("--learned <text>", "What you learned from users")
  .option("--goal <goals...>", "Goals for next week (can specify multiple)");
addCookieOption(updatesNew);

updatesNew.action(async (opts) => {
  try {
    const client = await getClient(opts.cookieSource, opts.chromeProfile);

    let input: UpdateInput;

    // If all required flags provided, skip interactive mode
    if (opts.metric && opts.morale && opts.talkedTo) {
      input = {
        metric_value: Number(opts.metric),
        morale: Number(opts.morale),
        talked_to: Number(opts.talkedTo),
        biggest_change: opts.change,
        biggest_blocker: opts.blocker,
        learned_from_users: opts.learned,
        goals: opts.goal,
      };
    } else {
      // Interactive mode
      const rl = createInterface({ input: stdin, output: stdout });

      console.log(kleur.bold("New Weekly Update"));
      console.log(kleur.dim("Fill in your update (press Enter to skip optional fields)"));
      console.log();

      const metricStr = opts.metric || (await rl.question("Primary metric value *: "));
      const moraleStr = opts.morale || (await rl.question("Morale (1-10) *: "));
      const talkedToStr = opts.talkedTo || (await rl.question("Users talked to *: "));
      const change = opts.change || (await rl.question("What most improved your metric? "));
      const blocker = opts.blocker || (await rl.question("Biggest obstacle? "));
      const learned = opts.learned || (await rl.question("What did you learn from users? "));
      const goalsStr = await rl.question("Goals for next week (comma-separated): ");

      rl.close();

      input = {
        metric_value: Number(metricStr),
        morale: Number(moraleStr),
        talked_to: Number(talkedToStr),
        biggest_change: change || undefined,
        biggest_blocker: blocker || undefined,
        learned_from_users: learned || undefined,
        goals: goalsStr ? goalsStr.split(",").map((g) => g.trim()).filter(Boolean) : undefined,
      };
    }

    // Validate
    if (isNaN(input.metric_value) || isNaN(input.morale) || isNaN(input.talked_to)) {
      console.error(kleur.red("Metric, morale, and talked-to must be numbers."));
      process.exit(1);
    }
    if (input.morale < 1 || input.morale > 10) {
      console.error(kleur.red("Morale must be between 1 and 10."));
      process.exit(1);
    }

    console.log();
    console.log(kleur.dim("Submitting update..."));
    const resultUrl = await client.createUpdate(input);
    console.log(kleur.green("Update submitted!"));
    console.log(kleur.dim(resultUrl));
  } catch (err) {
    handleError(err);
  }
});

program.parse();
