---
title: Keyboard Shortcuts
description: Customize keybindings for the TUI
---

ArgusDev's terminal interface (TUI) supports customizable keyboard shortcuts for common actions.

## Available Shortcuts

| Action | Default | Description |
|--------|---------|-------------|
| **Return to Menu** | `Ctrl+E` | Exit the current session view and return to the main menu |
| **Cancel** | `Escape` | Cancel the current operation or close dialogs |

## Configuring Shortcuts

1. Open **Settings** in the WebUI
2. Go to **Shortcuts**
3. Click on a shortcut to change it
4. Press your desired key combination
5. Save

## Key Format

Shortcuts can include modifiers:

- `ctrl` - Control key
- `alt` - Alt/Option key
- `shift` - Shift key

Plus a base key (letter, number, or special key like `escape`).

Example combinations:
- `Ctrl+R` - Control + R
- `Alt+X` - Alt + X
- `Escape` - Just the Escape key (no modifier)

## Reserved Keys

These combinations can't be used as shortcuts:

- `Ctrl+C` - Reserved for interrupt/copy
- `Ctrl+D` - Reserved for EOF/logout
- `Ctrl+[` - Equivalent to Escape

## Configuration File

Shortcuts are stored in your config file at `~/.config/argusdev/config.json`:

```json
{
  "shortcuts": {
    "returnToMenu": {
      "ctrl": true,
      "key": "e"
    },
    "cancel": {
      "key": "escape"
    }
  }
}
```

## Notes

- Shortcuts apply to the TUI only, not the WebUI
- The WebUI uses standard browser shortcuts
- Changes take effect immediately after saving
