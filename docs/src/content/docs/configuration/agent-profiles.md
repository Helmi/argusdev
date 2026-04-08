---
title: Agent Profiles
description: Customize how AI agents are configured and launched
---

Agent profiles define how each AI assistant is launched and what options are available when starting a session. You can customize the built-in profiles or create entirely new ones for any CLI tool.

## Managing Agents in the WebUI

The easiest way to configure agents is through the WebUI:

1. Open ArgusDev in your browser
2. Click the **gear icon** in the header to open Settings
3. Select **Agents** from the sidebar

<div class="screenshot-placeholder">
Screenshot: Settings → Agents panel showing the list of configured agents
</div>

From here you can:
- Edit existing agent configurations
- Add new custom agents
- Set the default agent for new sessions
- Delete agents you don't use

## What's in a Profile

Each agent profile consists of:

| Field | Description |
|-------|-------------|
| **Name** | Display name shown in the UI |
| **Command** | The CLI executable (e.g., `claude`, `gemini`, `codex`) |
| **Kind** | Either `agent` (AI assistant) or `terminal` (plain shell) |
| **Description** | Optional text explaining what this profile is for |
| **Icon** | Visual identifier - pick from brand icons or generic ones |
| **Options** | Configurable flags that appear when creating a session |

## Built-in Profiles

ArgusDev auto-detects and configures these agents during setup:

- **Claude Code** - Anthropic's CLI assistant with YOLO mode, model selection, continue/resume options
- **Gemini CLI** - Google's assistant with model selection
- **Codex CLI** - OpenAI's assistant with model selection
- **Cursor Agent** - Cursor's CLI interface
- **Droid**, **Kilocode**, **Opencode** - Other CLI assistants
- **Terminal** - Plain shell, always available

## Custom Options

The real power of agent profiles is custom options. Each option you add becomes a configurable setting when starting a session.

<div class="screenshot-placeholder">
Screenshot: Adding a custom option with flag, type, and default value
</div>

### Option Fields

| Field | Purpose |
|-------|---------|
| **Label** | What the user sees (e.g., "YOLO Mode", "Model") |
| **CLI Flag** | The actual flag passed to the agent (e.g., `--dangerously-skip-permissions`) |
| **Type** | `boolean` for toggles, `string` for text/dropdowns |
| **Description** | Help text explaining what the option does |
| **Default** | Pre-selected value when creating a session |
| **Choices** | For string type - limit input to specific values |
| **Group** | Mutual exclusivity - only one option in a group can be selected |

### Boolean Options

Toggle flags on or off. When enabled, the flag is added to the command.

Example: Claude's YOLO mode
- **Label:** `YOLO Mode`
- **Flag:** `--dangerously-skip-permissions`
- **Type:** `boolean`

When enabled, the session starts with `claude --dangerously-skip-permissions`.

### String Options with Choices

Create dropdowns for predefined values.

Example: Model selection
- **Label:** `Model`
- **Flag:** `--model`
- **Type:** `string`
- **Choices:** `sonnet:Sonnet, opus:Opus, haiku:Haiku`
- **Default:** `sonnet`

The choices format is `value:label` - the value goes in the command, the label is shown in the UI.

### String Options without Choices

Free text input that becomes a flag value.

Example: Custom prompt
- **Label:** `System Prompt`
- **Flag:** `--system-prompt`
- **Type:** `string`

### Mutually Exclusive Options

Use the **Group** field to make options mutually exclusive. Only one option in a group can be active.

Example: Claude's continue/resume modes - you can't use both at once, so they share a group called `resume-mode`.

## Creating a New Agent

Click **Add Agent** at the bottom of the agents list.

1. **Name** - Give it a clear name
2. **Command** - The CLI command to run
3. **Kind** - Usually `agent` unless it's a plain terminal
4. **Icon** - Pick one that makes sense (auto-matched from command if possible)
5. **Options** - Add any flags you want to configure

### Example: Claude with Project Defaults

Say you have a project that always needs Claude with specific settings:

- **Name:** Claude (Project X)
- **Command:** claude
- **Options:**
  - Model: opus (default)
  - YOLO Mode: enabled by default
  - Custom flag: `--project-dir /path/to/project`

Now you can start sessions for this project without reconfiguring each time.

## Setting the Default Agent

One agent is marked as default - this is pre-selected when creating new sessions. To change it:

1. Go to **Settings** → **Agents**
2. Find the agent you want as default
3. Click the star icon or "Set as Default"

## Icons and Colors

Each agent can have a custom icon:

- **Brand icons** - Claude, Gemini, etc. have their official icons
- **Generic icons** - Terminal, bot, code, etc. - can be colored with your choice

The icon picker shows all available options. For generic icons, you can also pick a custom color.

## Tips

- Create focused profiles for specific workflows (e.g., "Claude for Testing", "Claude for Docs")
- Use mutually exclusive groups when options conflict
- If you frequently switch an agent's settings, make multiple profiles instead of reconfiguring each time
- The description field helps when you have many similar profiles
