# Keyboard Rage Detector

A funny-but-useful VS Code extension that detects keyboard smashing and intervenes with calming chaos.

## Features

- Detects keyboard smash patterns like:
  - `asdfghjkl`
  - `qwerty`
  - `;;;;;`
  - `/////`
  - repeated chars like `aaaaaa`
- Detects high-speed random typing bursts.
- Works across regular editor files and notebook cell edits.
- Monitors terminal shell commands (when VS Code shell integration is active).
- Supports external/chat integrations through a command trigger.
- Shows a **Calm-down popup** with:
  - `I am calm now`
  - `It deserved it`
- Optional **temporary typing lock** (default 3 seconds).
- Funny advice messages.
- Modes:
  - `normal`
  - `cat` (shows random cat GIF panel)
  - `zen`
  - `chaos`
- **Emergency Debug Survival Mode** when rage occurs 3 times in 2 minutes.
- Tracks rage statistics:
  - today's smashes
  - weekly smashes
  - longest rage session
  - most violent file
- Easter eggs:
  - typing `sudo fix my life` → `Permission denied.`
  - 10 smashes → `Achievement unlocked: Senior Developer`

## Commands

- `Rage Detector: Show Stats`
- `Rage Detector: Open Debug Survival Mode`
- `Rage Detector: Reset Stats`
- `Rage Detector: Trigger Manual Rage Event`
- `Rage Detector: Report External Input`

## Settings

- `rageDetector.mode`: `normal | cat | zen | chaos`
- `rageDetector.enableTemporaryLock`: `true/false`
- `rageDetector.lockDurationMs`: number (ms)
- `rageDetector.enableFunnyAdvice`: `true/false`
- `rageDetector.enableTerminalDetection`: `true/false`

## Chat/IDE integration

If another extension or IDE-connected chatbot can execute VS Code commands, it can call:

- Command: `rageDetector.reportExternalInput`
- Payload example:
  - `{ "text": "asdfghjkl;;;;", "source": "chatbot" }`

You can also run `Rage Detector: Trigger Manual Rage Event` from the Command Palette for quick testing.

## Run locally

1. Install dependencies:
   - `npm install`
2. Compile:
   - `npm run compile`
3. Press `F5` in VS Code to launch the Extension Development Host.

## Notes

- Typing lock is implemented by intercepting the VS Code `type` command.
- Statistics are stored in VS Code global state.
- Terminal detection depends on VS Code shell integration events.
