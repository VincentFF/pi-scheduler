# pi-scheduler

Schedule timed prompts for pi. Supports one-time and periodic tasks using a **fixed-format template** — no AI parsing required, so it works even when your token quota is exhausted.

## Why pi-scheduler?

- **Token-independent**: All schedule parsing uses regex, not AI. Schedule tasks even when you're rate-limited or out of tokens.
- **Two config methods**: Add tasks interactively via `/schedule add` or edit the JSON config file directly.
- **Flexible timing**: One-time (absolute or relative), daily, hourly, interval-based, weekly.

## Installation

```bash
pi install npm:@vincentff/pi-scheduler
```

Or for local development:

```bash
pi install ./path/to/pi-scheduler
```

## Template Format

```
<schedule-spec> | <prompt>
```

### One-time Tasks

| Template | Example |
|----------|---------|
| `at YYYY-MM-DD HH:mm` | `at 2025-12-31 23:59 \| Happy new year!` |
| `in Ns` / `Nm` / `Nh` / `Nd` | `in 30m \| Check server status` |

### Periodic Tasks

| Template | Example |
|----------|---------|
| `daily HH:mm` | `daily 09:00 \| Good morning summary` |
| `hourly` | `hourly \| Health check` |
| `every Ns/Nm/Nh/Nd` | `every 2h \| Long-running task check` |
| `weekly DAY HH:mm` | `weekly mon 09:00 \| Weekly planning` |

Days: `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`

## Usage Examples

### Example 1: Token Quota Reset Retry

You hit the rate limit, but your quota resets in 45 minutes. Schedule pi to automatically retry:

```
/schedule add in 45m | Retry my last request: review the auth module refactoring
```

When the timer fires, pi sends the prompt as a user message — as if you typed it yourself. You can step away and come back to the result.

### Example 2: Daily Morning Briefing

Set up a recurring task to kick off every workday:

```
/schedule add daily 09:00 | Good morning! Check my git history since yesterday, summarize what I worked on, and suggest the top 3 priorities for today.
```

Or configure multiple tasks in the config file for a full daily routine:

```json
{
  "tasks": [
    {
      "id": "morning-brief",
      "schedule": "daily 09:00",
      "prompt": "Summarize recent changes in the repo and suggest today's priorities",
      "enabled": true,
      "createdAt": "2025-07-21T00:00:00.000Z"
    },
    {
      "id": "afternoon-check",
      "schedule": "daily 14:00",
      "prompt": "Review open issues and remind me of any pending code reviews",
      "enabled": true,
      "createdAt": "2025-07-21T00:00:00.000Z"
    }
  ],
  "paused": false
}
```

## Commands

| Command | Description |
|---------|-------------|
| `/schedule add <template>` | Add a scheduled task |
| `/schedule list` | List all tasks with next run times |
| `/schedule remove <id>` | Remove a task (prefix match) |
| `/schedule toggle <id>` | Enable/disable a task |
| `/schedule pause` | Pause all scheduling |
| `/schedule resume` | Resume all scheduling |
| `/schedule clear` | Remove all tasks |
| `/schedule help` | Show template reference |

## Config File

Tasks are stored in JSON. Edit directly for bulk changes:

**Global:** `~/.pi/agent/scheduler-tasks.json`
**Project:** `.pi/scheduler-tasks.json` (takes precedence)

```json
{
  "tasks": [
    {
      "id": "a1b2c3d4-...",
      "schedule": "daily 09:00",
      "prompt": "Summarize my agenda for today",
      "enabled": true,
      "createdAt": "2025-01-15T08:00:00.000Z"
    },
    {
      "id": "e5f6g7h8-...",
      "schedule": "in 30m",
      "prompt": "Check the build status",
      "enabled": true,
      "createdAt": "2025-01-15T09:00:00.000Z"
    }
  ],
  "paused": false
}
```

## License

MIT
