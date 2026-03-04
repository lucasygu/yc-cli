#!/usr/bin/env node
/**
 * yc — CLI for Y Combinator Startup School, a16z Speedrun, and SPC
 *
 * Submit weekly updates, track your streak, manage your YC journey,
 * apply to a16z Speedrun and South Park Commons — all from the terminal.
 */

import { Command } from "commander";
import kleur from "kleur";
import { createInterface } from "node:readline/promises";
import { readFile, writeFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { extractCookies, type CookieSource } from "./lib/cookies.js";
import { YcClient, YcApiError, NotAuthenticatedError, type UpdateInput } from "./lib/client.js";
import {
  SpeedrunClient,
  SpeedrunApiError,
  CATEGORIES,
  EDUCATION_LEVELS,
  type SpeedrunApplication,
  type SpeedrunCeo,
} from "./lib/speedrun.js";
import {
  SPC_FORMS,
  SpcError,
  HOW_HEARD_OPTIONS,
  fillSpcForm,
  type SpcApplication,
  type SpcFounder,
  type SpcFormType,
} from "./lib/spc.js";

const program = new Command();

program
  .name("yc")
  .description("CLI for YC Startup School, a16z Speedrun, and South Park Commons")
  .version("0.2.0");

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
  } else if (err instanceof SpcError) {
    console.error(kleur.red(`SPC error: ${err.message}`));
  } else if (err instanceof SpeedrunApiError) {
    console.error(kleur.red(`Speedrun API error: ${err.message}`));
    if (err.response) {
      console.error(kleur.dim(err.response.slice(0, 300)));
    }
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

// --- speedrun ---

const speedrun = program
  .command("speedrun")
  .description("a16z Speedrun application");

// --- speedrun apply ---

const speedrunApply = speedrun
  .command("apply")
  .description("Submit a16z Speedrun application (interactive or from JSON file)")
  .option("--from-json <file>", "Load application from a JSON file")
  .option("--dry-run", "Validate and show payload without submitting");

speedrunApply.action(async (opts) => {
  try {
    const client = new SpeedrunClient();
    let application: SpeedrunApplication;

    if (opts.fromJson) {
      const raw = await readFile(opts.fromJson, "utf-8");
      application = JSON.parse(raw) as SpeedrunApplication;
      console.log(kleur.dim(`Loaded application from ${opts.fromJson}`));
    } else {
      // Interactive mode
      const rl = createInterface({ input: stdin, output: stdout });

      console.log(kleur.bold("a16z Speedrun Application"));
      console.log(kleur.dim("Fill in your application. Press Enter to skip optional fields."));
      console.log();

      // --- Step 1: Startup Details ---
      console.log(kleur.bold("1. Startup Details"));
      const companyName = await rl.question("  Company name *: ");
      const oneLiner = await rl.question("  One-liner *: ");
      const startupDescription = await rl.question("  Description *: ");

      console.log(kleur.dim("  Categories: " + CATEGORIES.join(", ")));
      const primaryCategory = await rl.question("  Primary category *: ");
      const secondaryCategory = await rl.question("  Secondary category *: ");

      const city = await rl.question("  City *: ");
      const country = await rl.question("  Country *: ");
      const state = await rl.question("  State (US only, optional): ");
      const foundedYear = await rl.question("  Founded year *: ");
      const foundedMonth = await rl.question("  Founded month (1-12) *: ");
      const website = await rl.question("  Website: ");
      const otherDescription = await rl.question("  Anything else about your startup: ");

      console.log();

      // --- Step 2: Team ---
      console.log(kleur.bold("2. Team"));
      const employmentType = await rl.question("  Full-time or Part-time? *: ");
      const fullTimeFounders = await rl.question("  Number of full-time founders *: ");
      const totalFteEmployees = await rl.question("  Total FTE employees *: ");
      const relevantExperience = await rl.question("  Team relevant experience *: ");

      console.log();
      console.log(kleur.bold("  CEO / Lead Founder"));
      const firstName = await rl.question("    First name *: ");
      const lastName = await rl.question("    Last name *: ");
      const email = await rl.question("    Email *: ");
      const phoneNumber = await rl.question("    Phone *: ");
      const ceoCity = await rl.question("    City *: ");
      const ceoCountry = await rl.question("    Country *: ");
      const ceoState = await rl.question("    State (US only, optional): ");
      const citizenship = await rl.question("    Citizenship *: ");
      const college = await rl.question("    College *: ");
      console.log(kleur.dim("    Education: " + EDUCATION_LEVELS.join(", ")));
      const highestEducation = await rl.question("    Highest education *: ");
      const yearsOfExperience = await rl.question("    Years of experience *: ");
      const isTechnicalStr = await rl.question("    Technical? (yes/no) *: ");
      const linkedinUrl = await rl.question("    LinkedIn URL *: ");
      const githubUrl = await rl.question("    GitHub URL: ");
      const xUrl = await rl.question("    X/Twitter URL: ");
      const portfolioUrl = await rl.question("    Portfolio URL: ");

      const ceo: SpeedrunCeo = {
        first_name: firstName,
        last_name: lastName,
        email,
        phone_number: phoneNumber,
        city: ceoCity,
        country: ceoCountry,
        citizenship,
        college,
        highest_education: highestEducation,
        years_of_experience: Number(yearsOfExperience),
        is_technical: isTechnicalStr.toLowerCase().startsWith("y"),
        linkedin_url: linkedinUrl,
        ...(ceoState && { state: ceoState }),
        ...(githubUrl && { github_url: githubUrl }),
        ...(xUrl && { x_url: xUrl }),
        ...(portfolioUrl && { portfolio_url: portfolioUrl }),
      };

      // Co-founders
      const cofounderCountStr = await rl.question("\n  Number of co-founders (0 for none): ");
      const cofounderCount = Number(cofounderCountStr) || 0;
      const otherFounders = [];
      for (let i = 0; i < cofounderCount; i++) {
        console.log(kleur.bold(`  Co-founder ${i + 1}`));
        const cfFirst = await rl.question("    First name *: ");
        const cfLast = await rl.question("    Last name *: ");
        const cfEmail = await rl.question("    Email *: ");
        const cfPhone = await rl.question("    Phone: ");
        const cfLinkedin = await rl.question("    LinkedIn URL *: ");
        otherFounders.push({
          first_name: cfFirst,
          last_name: cfLast,
          email: cfEmail,
          ...(cfPhone && { phone_number: cfPhone }),
          linkedin_url: cfLinkedin,
        });
      }

      console.log();

      // --- Step 3: Additional Info ---
      console.log(kleur.bold("3. Additional Information"));

      const hasFundingStr = await rl.question("  Has previous funding? (yes/no): ");
      const hasFunding = hasFundingStr.toLowerCase().startsWith("y");

      let funding;
      if (hasFunding) {
        const totalFunded = await rl.question("    Total funded (USD) *: ");
        const postMoneyVal = await rl.question("    Post-money valuation (USD) *: ");
        const burnRate = await rl.question("    Monthly burn (USD) *: ");
        const runway = await rl.question("    Runway (months) *: ");
        funding = {
          funding_total_usd: Number(totalFunded),
          post_money_valuation_usd: Number(postMoneyVal),
          burn_monthly_usd: Number(burnRate),
          runway_months: Number(runway),
          investors: [] as Array<{ name: string; email: string; amount_usd?: number }>,
        };
      }

      const isFundraisingStr = await rl.question("  Currently fundraising? (yes/no): ");
      const isFundraising = isFundraisingStr.toLowerCase().startsWith("y");
      let currentFundraise;
      if (isFundraising) {
        const targetAmount = await rl.question("    Target amount (USD) *: ");
        const startDate = await rl.question("    Start date (YYYY-MM) *: ");
        const targetDesc = await rl.question("    Target description *: ");
        currentFundraise = {
          fundraising_target_amount_usd: Number(targetAmount),
          fundraising_start_date: startDate,
          fundraising_target_description: targetDesc,
        };
      }

      const hasMetricsStr = await rl.question("  Has metrics to share? (yes/no): ");
      const hasMetrics = hasMetricsStr.toLowerCase().startsWith("y");
      let metrics;
      if (hasMetrics) {
        const launchYear = await rl.question("    Launch year *: ");
        const launchMonth = await rl.question("    Launch month (1-12) *: ");
        const metricsDesc = await rl.question("    Metrics description: ");
        metrics = {
          launch_date: `${launchYear}-${launchMonth.padStart(2, "0")}`,
          ...(metricsDesc && { metrics_description: metricsDesc }),
        };
      }

      const hasReferralStr = await rl.question("  Have a referral? (yes/no): ");
      const hasReferral = hasReferralStr.toLowerCase().startsWith("y");
      let referral;
      if (hasReferral) {
        const refName = await rl.question("    Referral name *: ");
        const refEmail = await rl.question("    Referral email *: ");
        const refLinkedin = await rl.question("    Referral LinkedIn *: ");
        referral = { name: refName, email: refEmail, linkedin_url: refLinkedin };
      }

      const learnedAbout = await rl.question("  How did you hear about Speedrun? ");

      rl.close();

      const foundingDate = `${foundedYear}-${foundedMonth.padStart(2, "0")}`;

      application = {
        company_name: companyName,
        one_liner: oneLiner,
        company_description: startupDescription,
        primary_category: primaryCategory,
        secondary_category: secondaryCategory,
        company_city: city,
        company_country: country,
        ...(state && { company_state: state }),
        founding_date: foundingDate,
        ...(website && { website_url: website }),
        ...(otherDescription && { other_description: otherDescription }),
        is_full_time: employmentType.toLowerCase().startsWith("f"),
        num_full_time_founders: fullTimeFounders,
        num_full_time_employees: Number(totalFteEmployees),
        team_description: relevantExperience,
        ceo,
        other_founders: otherFounders,
        has_funding: hasFunding,
        ...(funding && { funding }),
        is_fundraising: isFundraising,
        ...(currentFundraise && { current_fundraise: currentFundraise }),
        has_metrics: hasMetrics,
        ...(metrics && { metrics }),
        has_referral: hasReferral,
        ...(referral && { referral }),
        ...(learnedAbout && { learned_about_speedrun: learnedAbout }),
      };
    }

    if (opts.dryRun) {
      console.log();
      console.log(kleur.bold("Dry run — payload:"));
      console.log(JSON.stringify(application, null, 2));
      return;
    }

    console.log();
    console.log(kleur.dim("Submitting application..."));
    const result = await client.submitApplication(application);
    console.log(kleur.green("Application submitted!"));
    console.log(kleur.dim(JSON.stringify(result)));
  } catch (err) {
    handleError(err);
  }
});

// --- speedrun template ---

const speedrunTemplate = speedrun
  .command("template")
  .description("Generate a JSON template for Speedrun application");

speedrunTemplate.action(() => {
  const template: SpeedrunApplication = {
    company_name: "My Startup",
    one_liner: "One sentence about what we do",
    company_description: "Longer description of the startup...",
    primary_category: "Infrastructure / Dev Tools",
    secondary_category: "B2B / Enterprise Applications",
    company_city: "San Francisco",
    company_state: "California",
    company_country: "United States",
    founding_date: "2025-01",
    website_url: "https://example.com",
    other_description: "",
    is_full_time: true,
    num_full_time_founders: "2",
    num_full_time_employees: 3,
    team_description: "Describe your team's relevant experience...",
    ceo: {
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      phone_number: "+14155551234",
      city: "San Francisco",
      state: "California",
      country: "United States",
      citizenship: "United States",
      college: "Stanford University",
      highest_education: "Bachelor's Degree (BA, BS)",
      years_of_experience: 5,
      is_technical: true,
      linkedin_url: "https://linkedin.com/in/janedoe",
      github_url: "https://github.com/janedoe",
      x_url: "https://x.com/janedoe",
    },
    other_founders: [
      {
        first_name: "John",
        last_name: "Doe",
        email: "john@example.com",
        linkedin_url: "https://linkedin.com/in/johndoe",
      },
    ],
    has_funding: false,
    is_fundraising: true,
    current_fundraise: {
      fundraising_target_amount_usd: 500000,
      fundraising_start_date: "2025-03",
      fundraising_target_description: "Pre-seed round to hire first two engineers",
    },
    has_metrics: true,
    metrics: {
      launch_date: "2025-01",
      user_metrics: {
        daily_active_users: 100,
        weekly_active_users: 500,
        monthly_active_users: 2000,
        user_growth_rate_monthly: 15,
      },
      metrics_description: "Growing 15% MoM since launch",
    },
    has_referral: false,
    learned_about_speedrun: "Twitter",
  };

  console.log(JSON.stringify(template, null, 2));
});

// --- speedrun upload-deck ---

const speedrunUploadDeck = speedrun
  .command("upload-deck <file>")
  .description("Upload a pitch deck PDF and get the GCS URL");

speedrunUploadDeck.action(async (file) => {
  try {
    const client = new SpeedrunClient();
    const fileBuffer = await readFile(file);
    const contentType = file.endsWith(".pdf") ? "application/pdf" : "application/octet-stream";

    console.log(kleur.dim(`Requesting upload URL for ${file} (${fileBuffer.length} bytes)...`));
    const { url, ...rest } = await client.getUploadUrl(contentType, fileBuffer.length);

    console.log(kleur.dim("Uploading..."));
    await client.uploadFile(url, fileBuffer, contentType);

    console.log(kleur.green("Upload complete!"));
    console.log(kleur.dim("GCS URL (use as deck_gcs_url in your application):"));
    // The upload URL typically contains the GCS path
    console.log(JSON.stringify(rest, null, 2));
  } catch (err) {
    handleError(err);
  }
});

// --- spc ---

const spc = program
  .command("spc")
  .description("South Park Commons application");

// --- spc info ---

const spcInfo = spc
  .command("info")
  .description("Show SPC application info and form URLs");

spcInfo.action(() => {
  console.log(kleur.bold("South Park Commons — Applications"));
  console.log();

  for (const [key, form] of Object.entries(SPC_FORMS)) {
    console.log(`  ${kleur.bold(form.name)} (${key})`);
    console.log(`    ${kleur.dim(form.description)}`);
    console.log(`    ${kleur.cyan(form.url)}`);
    console.log();
  }

  console.log(kleur.dim("  SPC uses Airtable forms. To apply from the CLI:"));
  console.log(kleur.dim("  1. Generate a template: yc spc template > app.json"));
  console.log(kleur.dim("  2. Fill in your details in the JSON file"));
  console.log(kleur.dim("  3. Dry run: yc spc apply --from-json app.json --dry-run --headed"));
  console.log(kleur.dim("  4. Submit: yc spc apply --from-json app.json"));
});

// --- spc template ---

const spcTemplate = spc
  .command("template")
  .description("Generate a JSON template for SPC application")
  .option("--type <type>", "Form type: fellowship or membership", "fellowship");

spcTemplate.action((opts) => {
  const formType = opts.type === "membership" ? "memberResidency" : "founderFellowship";
  const form = SPC_FORMS[formType];

  const template: SpcApplication = {
    founders: [
      {
        fullName: "Jane Doe",
        email: "jane@example.com",
        linkedin: "https://linkedin.com/in/janedoe",
        phone: "+14155551234",
      },
    ],
    roles: "CEO/technical — building the product full-time",
    location: "San Francisco, CA",
    howHeard: "From an SPC Member",
    howHeardElaborate: "Referred by [Name], SPC Fellow S25",
    financingHistory: "Bootstrapped, no external funding yet",
    accomplishments: "Built and scaled X to Y users at BigCo. Published research on Z...",
    riskiestDecision: "Left a senior role at BigCo to go full-time on this idea...",
    threeRecruits: "1) Alice (ex-Google ML lead) 2) Bob (Stanford PhD, NLP) 3) Carol (ex-Stripe eng manager)",
    ideasRanked: "1. AI-powered developer tools 2. Open-source LLM infrastructure",
    ideaDetail: "Detailed description of your top idea, the problem, your insight, and why now...",
    whyExcited: "Why this problem excites you and why now is the right time...",
    expertise: "Your relevant expertise and why you're the right person to solve this...",
    progress: "What you've built or learned so far...",
    demoLink: "https://example.com/demo",
    secondIdea: "Optional: describe your second-ranked idea...",
    optionalChanges: "",
    backupIdeas: "",
    stayInTouch: true,
  };

  console.log(JSON.stringify({
    _form: form.name,
    _url: form.url,
    _howHeardOptions: HOW_HEARD_OPTIONS,
    _note: "Fill in your details. Run: yc spc apply --from-json <file>",
    ...template,
  }, null, 2));
});

// --- spc open ---

const spcOpen = spc
  .command("open")
  .description("Open SPC application form in browser")
  .option("--type <type>", "Form type: fellowship or membership", "fellowship");

spcOpen.action(async (opts) => {
  const formType = opts.type === "membership" ? "memberResidency" : "founderFellowship";
  const form = SPC_FORMS[formType];

  console.log(kleur.dim(`Opening ${form.name} form...`));
  const { execFile } = await import("node:child_process");
  execFile("open", [form.url]);
  console.log(kleur.green(`Opened: ${form.url}`));
});

// --- spc apply ---

const spcApply = spc
  .command("apply")
  .description("Fill and submit SPC application via Playwright")
  .option("--type <type>", "Form type: fellowship or membership", "fellowship")
  .option("--from-json <file>", "Load application from JSON file")
  .option("--dry-run", "Fill form but do not submit")
  .option("--headed", "Show browser window (default: headless)");

spcApply.action(async (opts) => {
  try {
    const formType = (opts.type === "membership" ? "memberResidency" : "founderFellowship") as SpcFormType;
    let application: SpcApplication;

    if (opts.fromJson) {
      const raw = await readFile(opts.fromJson, "utf-8");
      const parsed = JSON.parse(raw);
      // Strip metadata keys (prefixed with _)
      const { _form, _url, _howHeardOptions, _note, ...appData } = parsed;
      application = appData as SpcApplication;
      console.log(kleur.dim(`Loaded application from ${opts.fromJson}`));
    } else {
      // Interactive mode
      const rl = createInterface({ input: stdin, output: stdout });
      const form = SPC_FORMS[formType];

      console.log(kleur.bold(`SPC ${form.name} Application`));
      console.log(kleur.dim("Fill in your application. Press Enter to skip optional fields."));
      console.log();

      // Founders
      console.log(kleur.bold("Founder #1 (required)"));
      const f1Name = await rl.question("  Full name *: ");
      const f1Email = await rl.question("  Email *: ");
      const f1Linkedin = await rl.question("  LinkedIn URL *: ");
      const f1Phone = await rl.question("  Phone: ");
      const founders: SpcFounder[] = [{
        fullName: f1Name,
        email: f1Email,
        linkedin: f1Linkedin,
        ...(f1Phone && { phone: f1Phone }),
      }];

      const moreFounders = await rl.question("\n  Additional founders? (0-3): ");
      const extraCount = Math.min(Number(moreFounders) || 0, 3);
      for (let i = 0; i < extraCount; i++) {
        console.log(kleur.bold(`\n  Founder #${i + 2}`));
        const name = await rl.question("    Full name *: ");
        const email = await rl.question("    Email *: ");
        const linkedin = await rl.question("    LinkedIn URL *: ");
        const phone = await rl.question("    Phone: ");
        founders.push({ fullName: name, email, linkedin, ...(phone && { phone }) });
      }

      console.log();
      console.log(kleur.bold("Team"));
      const roles = await rl.question("  Roles (what does each founder do?) *: ");
      const location = await rl.question("  Location (city, state/country) *: ");

      console.log();
      console.log(kleur.bold("Discovery"));
      console.log(kleur.dim("  Options: " + HOW_HEARD_OPTIONS.join(", ")));
      const howHeard = await rl.question("  How did you hear about SPC? *: ");
      const howHeardElaborate = await rl.question("  Elaborate: ");

      console.log();
      console.log(kleur.bold("Background"));
      const financingHistory = await rl.question("  Financing history: ");
      const accomplishments = await rl.question("  Accomplishments *: ");
      const riskiestDecision = await rl.question("  Riskiest decision *: ");
      const threeRecruits = await rl.question("  Three people you'd recruit *: ");

      console.log();
      console.log(kleur.bold("Ideas"));
      const ideasRanked = await rl.question("  Ideas/areas ranked *: ");
      const ideaDetail = await rl.question("  Detail on top idea *: ");
      const secondIdea = await rl.question("  Second idea (optional): ");
      const optionalChanges = await rl.question("  Optional changes: ");
      const backupIdeas = await rl.question("  Backup ideas: ");

      rl.close();

      application = {
        founders,
        roles,
        location,
        howHeard,
        ...(howHeardElaborate && { howHeardElaborate }),
        ...(financingHistory && { financingHistory }),
        accomplishments,
        riskiestDecision,
        threeRecruits,
        ideasRanked,
        ideaDetail,
        ...(secondIdea && { secondIdea }),
        ...(optionalChanges && { optionalChanges }),
        ...(backupIdeas && { backupIdeas }),
        stayInTouch: true,
      };
    }

    console.log();
    console.log(kleur.dim("Launching browser and filling form..."));

    const result = await fillSpcForm(application, {
      formType,
      headed: !!opts.headed,
      dryRun: !!opts.dryRun,
      onStatus: (msg) => console.log(kleur.dim(`  ${msg}`)),
    });

    if (result.submitted) {
      console.log(kleur.green("\nApplication submitted!"));
    } else {
      console.log(kleur.yellow("\nForm filled (not submitted — dry run)."));
    }
    if (result.screenshotPath) {
      console.log(kleur.dim(`Screenshot: ${result.screenshotPath}`));
    }
  } catch (err) {
    handleError(err);
  }
});

program.parse();
