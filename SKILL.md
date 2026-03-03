---
description: Manage Y Combinator Startup School from the terminal — weekly updates, dashboard, progress tracking
allowed-tools: Bash, Read, Write
name: yc
version: 0.1.0
metadata:
  openclaw:
    requires:
      bins:
        - yc
    install:
      - kind: node
        package: "@lucasygu/yc-cli"
        bins: [yc]
    os: [macos]
    homepage: https://github.com/lucasygu/yc-cli
tags:
  - ycombinator
  - startup-school
  - productivity
---

# YC CLI — Y Combinator Startup School

CLI tool for managing your YC Startup School journey. Submit weekly updates, track your streak, and view your dashboard — all from the terminal.

## Prerequisites

- Node.js 22+
- Logged into [startupschool.org](https://www.startupschool.org/) in Chrome
- macOS (for cookie extraction from Chrome Keychain)

## Quick Reference

```bash
yc whoami                    # Test connection, show user info
yc dashboard                 # Show streak, curriculum, weekly status
yc updates                   # List all weekly updates
yc show <id>                 # Show a single update in detail
yc new                       # Submit new weekly update (interactive)
yc new --metric 5 --morale 7 --talked-to 3   # Non-interactive
```

## Commands

### `yc whoami`
Test your connection and display user info (name, track, slug).

### `yc dashboard`
Show your Startup School dashboard:
- Current streak (consecutive weeks of updates)
- Curriculum progress (completed/required)
- Next curriculum item
- Recent weekly update status (submitted/missing)

### `yc updates`
List all your weekly updates with metric values, morale scores, and highlights.

### `yc show <id>`
Display a single update in full detail including goals and their completion status.

### `yc new`
Submit a new weekly update. Runs in interactive mode by default (prompts for each field).

**Interactive mode:**
```bash
yc new
# Prompts for: metric value, morale, users talked to, changes, blockers, goals
```

**Flag mode (for automation):**
```bash
yc new \
  --metric 10 \
  --morale 8 \
  --talked-to 5 \
  --change "Shipped MVP to first 10 users" \
  --blocker "Payment integration delayed" \
  --learned "Users want simpler onboarding" \
  --goal "Launch public beta" \
  --goal "Set up analytics"
```

## Global Options

All commands support:
- `--cookie-source <browser>` — Browser to read cookies from (chrome, safari, firefox). Default: chrome
- `--chrome-profile <name>` — Specific Chrome profile directory name
- `--json` — Output raw JSON (for scripting)

## Workflows

### Weekly Update Routine
```bash
# Check if this week's update is submitted
yc dashboard

# If not, submit it
yc new

# Verify it shows up
yc updates
```

### Automation with Claude Code
When the user asks to submit their weekly update, use the `yc new` command with flags:
```bash
yc new --metric <value> --morale <1-10> --talked-to <count> \
  --change "summary" --blocker "obstacle" --goal "goal1" --goal "goal2"
```

## Authentication

YC CLI extracts session cookies directly from your browser — no API keys or tokens needed. Just log in to startupschool.org in Chrome and the CLI handles the rest.

If you get authentication errors:
1. Open Chrome and visit https://www.startupschool.org/
2. Make sure you're logged in (can see dashboard)
3. Try running `yc whoami` again
4. If still failing, log out and back in to refresh your session
