/**
 * pi-scheduler - Schedule timed prompts for pi
 *
 * Fixed-format templates (no AI parsing required):
 *
 *   One-time (absolute):
 *     at YYYY-MM-DD HH:mm | your prompt here
 *
 *   One-time (relative):
 *     in 30m | your prompt here
 *     in 2h  | your prompt here
 *     in 1d  | your prompt here
 *
 *   Periodic:
 *     daily 09:00        | your prompt here
 *     hourly             | your prompt here
 *     every 30m          | your prompt here
 *     every 2h           | your prompt here
 *     weekly mon 09:00   | your prompt here
 *
 * Commands:
 *   /cron add <template>    - Add a scheduled task
 *   /cron list              - List all tasks
 *   /cron remove <id>       - Remove a task
 *   /cron toggle <id>       - Enable/disable a task
 *   /cron pause             - Pause all scheduling
 *   /cron resume            - Resume all scheduling
 *   /cron clear             - Remove all tasks
 *   /cron help              - Show template help
 *
 * Config files (also editable directly):
 *   ~/.pi/agent/scheduler-tasks.json   (global)
 *   .pi/scheduler-tasks.json           (project-local)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { CONFIG_DIR_NAME, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScheduledTask {
  id: string;
  /** Raw schedule spec (e.g. "daily 09:00", "in 30m") */
  schedule: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  /** ISO timestamp of next run (informational, set at runtime) */
  nextRun?: string;
}

interface TasksConfig {
  tasks: ScheduledTask[];
  paused: boolean;
}

interface ResolvedTask extends ScheduledTask {
  /** Computed next run timestamp (ms) */
  nextRunAt: number;
  /** Timer handle */
  timer?: ReturnType<typeof setTimeout>;
}

interface ScheduleInfo {
  type: "absolute" | "relative" | "daily" | "hourly" | "every" | "weekly";
  /** Absolute datetime (ms) for "at" type */
  absolute?: number;
  /** Relative offset in ms for "in" type */
  offsetMs?: number;
  /** Time string HH:mm for daily/weekly */
  time?: string;
  /** Interval in ms for "every" type */
  intervalMs?: number;
  /** Day of week 0-6 (Sun=0) for "weekly" type */
  dayOfWeek?: number;
}

// ---------------------------------------------------------------------------
// Schedule spec parser — regex-only, no AI
// ---------------------------------------------------------------------------

const DAY_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/** Parse a duration like "30m", "2h", "1d", "90s" into milliseconds. */
function parseDuration(raw: string): number | null {
  const m = /^(\d+)\s*(s|m|h|d)$/i.exec(raw.trim());
  if (!m) return null;
  const num = parseInt(m[1], 10);
  switch (m[2].toLowerCase()) {
    case "s": return num * 1000;
    case "m": return num * 60 * 1000;
    case "h": return num * 60 * 60 * 1000;
    case "d": return num * 24 * 60 * 60 * 1000;
  }
  return null;
}

/** Parse HH:mm or HH:mm:ss into [hours, minutes]. */
function parseTime(raw: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return [h, min];
}

/** Parse a schedule spec string. Returns ScheduleInfo or null if unrecognized. */
function parseScheduleSpec(spec: string): ScheduleInfo | null {
  const s = spec.trim();

  // "at YYYY-MM-DD HH:mm" or "at YYYY-MM-DD HH:mm:ss"
  let m = /^at\s+(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)$/i.exec(s);
  if (m) {
    const dt = new Date(m[1] + "T" + m[2]);
    if (isNaN(dt.getTime())) return null;
    return { type: "absolute", absolute: dt.getTime() };
  }

  // "in Ns|Nm|Nh|Nd"
  m = /^in\s+(\d+\s*[smhd])$/i.exec(s);
  if (m) {
    const offset = parseDuration(m[1]);
    if (offset === null) return null;
    return { type: "relative", offsetMs: offset };
  }

  // "daily HH:mm"
  m = /^daily\s+(\d{1,2}:\d{2}(?::\d{2})?)$/i.exec(s);
  if (m) {
    const time = parseTime(m[1]);
    if (!time) return null;
    return { type: "daily", time: m[1] };
  }

  // "hourly"
  if (/^hourly$/i.test(s)) {
    return { type: "hourly" };
  }

  // "every Ns|Nm|Nh|Nd"
  m = /^every\s+(\d+\s*[smhd])$/i.exec(s);
  if (m) {
    const interval = parseDuration(m[1]);
    if (interval === null) return null;
    // minimum interval: 30 seconds to avoid spamming
    if (interval < 30_000) return null;
    return { type: "every", intervalMs: interval };
  }

  // "weekly DAY HH:mm"
  m = /^weekly\s+([a-z]{3})\s+(\d{1,2}:\d{2}(?::\d{2})?)$/i.exec(s);
  if (m) {
    const day = DAY_NAMES[m[1].toLowerCase()];
    if (day === undefined) return null;
    const time = parseTime(m[2]);
    if (!time) return null;
    return { type: "weekly", time: m[2], dayOfWeek: day };
  }

  return null;
}

/**
 * Compute the next run timestamp (ms) for a resolved ScheduleInfo.
 * `now` is the reference timestamp.
 */
function computeNextRun(info: ScheduleInfo, now: number): number | null {
  switch (info.type) {
    case "absolute":
      return info.absolute! <= now ? null : info.absolute!; // expired → null

    case "relative":
      return now + info.offsetMs!;

    case "hourly": {
      // Next hour mark
      const d = new Date(now);
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() + 1);
      return d.getTime();
    }

    case "daily": {
      const [h, min] = parseTime(info.time!)!;
      const d = new Date(now);
      d.setHours(h, min, 0, 0);
      if (d.getTime() <= now) d.setDate(d.getDate() + 1);
      return d.getTime();
    }

    case "every":
      return now + info.intervalMs!;

    case "weekly": {
      const [h, min] = parseTime(info.time!)!;
      const d = new Date(now);
      d.setHours(h, min, 0, 0);
      // Find next occurrence of the target day
      while (d.getDay() !== info.dayOfWeek || d.getTime() <= now) {
        d.setDate(d.getDate() + 1);
      }
      return d.getTime();
    }
  }
}

/**
 * Recompute the next run for a recurring task after it fires.
 */
function computeRecurringNextRun(info: ScheduleInfo, lastRun: number): number | null {
  switch (info.type) {
    case "hourly": {
      const d = new Date(lastRun);
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() + 1);
      return d.getTime();
    }
    case "daily": {
      const [h, min] = parseTime(info.time!)!;
      const d = new Date(lastRun);
      d.setHours(h, min, 0, 0);
      if (d.getTime() <= lastRun) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    case "every":
      return lastRun + info.intervalMs!;
    case "weekly": {
      const [h, min] = parseTime(info.time!)!;
      const d = new Date(lastRun);
      d.setHours(h, min, 0, 0);
      d.setDate(d.getDate() + 7);
      return d.getTime();
    }
    default:
      return null; // one-time tasks don't recur
  }
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP_TEXT = `
**pi-scheduler** — Fixed-format schedule templates

Format:  <schedule-spec> | <prompt>

── One-time ──────────────────────────────────────────
  at 2025-12-31 23:59 | Happy new year!
  in 30m              | Check server status
  in 2h               | Time for a break
  in 1d               | Review PRs tomorrow

── Periodic ──────────────────────────────────────────
  daily 09:00         | Good morning summary
  hourly              | Health check
  every 30m           | Quick status check
  every 2h            | Long-running task check
  weekly mon 09:00    | Weekly planning

── Commands ──────────────────────────────────────────
  /cron add <template>   Add a task
  /cron list             List all tasks
  /cron remove <id>      Remove a task
  /cron toggle <id>      Enable/disable
  /cron pause            Pause all
  /cron resume           Resume all
  /cron clear            Remove all
  /cron help             Show this help
`.trim();

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // ── State ──────────────────────────────────────────────
  const resolvedTasks = new Map<string, ResolvedTask>();
  let paused = false;
  let configPath = "";

  // ── Config file paths ─────────────────────────────────
  const getConfigPaths = (cwd: string) => {
    const home = process.env.HOME || process.env.USERPROFILE || "~";
    return {
      global: path.join(home, CONFIG_DIR_NAME, "agent", "scheduler-tasks.json"),
      project: path.join(cwd, CONFIG_DIR_NAME, "scheduler-tasks.json"),
    };
  };

  const loadConfig = (cwd: string): TasksConfig => {
    const paths = getConfigPaths(cwd);
    // Prefer project-local config; fall back to global
    for (const p of [paths.project, paths.global]) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        const cfg = JSON.parse(raw) as TasksConfig;
        if (cfg && Array.isArray(cfg.tasks)) {
          configPath = p;
          return { tasks: cfg.tasks ?? [], paused: cfg.paused ?? false };
        }
      } catch { /* file doesn't exist or is invalid */ }
    }
    // default to project-local for saving
    configPath = paths.project;
    return { tasks: [], paused: false };
  };

  const saveConfig = (cfg: TasksConfig): void => {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf-8");
  };

  // ── Timer management ──────────────────────────────────

  const clearAllTimers = () => {
    for (const rt of resolvedTasks.values()) {
      if (rt.timer) clearTimeout(rt.timer);
    }
    resolvedTasks.clear();
  };

  const scheduleTask = (ctx: ExtensionContext, task: ScheduledTask): void => {
    const info = parseScheduleSpec(task.schedule);
    if (!info) return;

    const now = Date.now();
    const nextRun = computeNextRun(info, now);
    if (nextRun === null) return; // expired one-time task

    const rt: ResolvedTask = { ...task, nextRunAt: nextRun };
    resolvedTasks.set(task.id, rt);

    if (paused || !task.enabled) return;

    const delay = Math.max(0, nextRun - now);
    rt.timer = setTimeout(() => {
      fireTask(ctx, rt, info);
    }, delay);
  };

  const fireTask = (ctx: ExtensionContext, rt: ResolvedTask, info: ScheduleInfo): void => {
    resolvedTasks.delete(rt.id);

    // Send the prompt to pi — use followUp so it works even when pi is busy
    pi.sendUserMessage(rt.prompt, { deliverAs: "followUp" });

    // Re-schedule recurring tasks, or remove one-time tasks from config
    const cfg = loadConfig(ctx.cwd);
    const nextRun = computeRecurringNextRun(info, Date.now());

    if (nextRun !== null) {
      // Recurring: set up next timer and update nextRun in config
      const newRt: ResolvedTask = { ...rt, nextRunAt: nextRun };
      if (!paused && rt.enabled) {
        newRt.timer = setTimeout(() => {
          fireTask(ctx, newRt, info);
        }, Math.max(0, nextRun - Date.now()));
      }
      resolvedTasks.set(rt.id, newRt);

      const idx = cfg.tasks.findIndex((t) => t.id === rt.id);
      if (idx >= 0) {
        cfg.tasks[idx].nextRun = new Date(nextRun).toISOString();
      }
    } else {
      // One-time task: remove from config
      cfg.tasks = cfg.tasks.filter((t) => t.id !== rt.id);
    }
    saveConfig(cfg);
  };

  // ── Bootstrap on session start ────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    clearAllTimers();
    const cfg = loadConfig(ctx.cwd);
    paused = cfg.paused;

    for (const task of cfg.tasks) {
      if (!task.enabled) continue;
      scheduleTask(ctx, task);
    }

    if (cfg.tasks.length > 0 && ctx.hasUI) {
      const enabled = cfg.tasks.filter((t) => t.enabled).length;
      const status = paused ? "(paused)" : `(${enabled} active)`;
      ctx.ui.notify(`scheduler loaded ${cfg.tasks.length} tasks ${status}`, "info");
    }
  });

  // ── Clean up on shutdown ──────────────────────────────
  pi.on("session_shutdown", async () => {
    clearAllTimers();
  });

  // ── /cron command ─────────────────────────────────────
  pi.registerCommand("cron", {
    description: "Manage scheduled prompts — add, list, remove, toggle, pause, resume, clear, help",
    handler: async (args, ctx) => {
      const raw = args.trim();

      // HELP
      if (!raw || raw === "help") {
        if (ctx.hasUI) {
          await ctx.ui.select("pi-scheduler Help", HELP_TEXT.split("\n"));
        }
        return;
      }

      // PAUSE
      if (raw === "pause") {
        paused = true;
        const cfg = loadConfig(ctx.cwd);
        cfg.paused = true;
        saveConfig(cfg);
        for (const rt of resolvedTasks.values()) {
          if (rt.timer) clearTimeout(rt.timer);
          rt.timer = undefined;
        }
        ctx.ui.notify("Scheduler paused", "warning");
        return;
      }

      // RESUME
      if (raw === "resume") {
        paused = false;
        const cfg = loadConfig(ctx.cwd);
        cfg.paused = false;
        saveConfig(cfg);
        // Re-schedule all enabled tasks
        for (const task of cfg.tasks) {
          if (!task.enabled) continue;
          if (resolvedTasks.has(task.id)) continue; // still in map, not yet fired
          scheduleTask(ctx, task);
        }
        ctx.ui.notify("Scheduler resumed", "info");
        return;
      }

      // CLEAR
      if (raw === "clear") {
        const ok = ctx.hasUI
          ? await ctx.ui.confirm("Clear all scheduled tasks?", "This cannot be undone.")
          : true;
        if (!ok) return;

        clearAllTimers();
        const cfg = loadConfig(ctx.cwd);
        cfg.tasks = [];
        saveConfig(cfg);
        ctx.ui.notify("All tasks cleared", "info");
        return;
      }

      // LIST
      if (raw === "list") {
        const cfg = loadConfig(ctx.cwd);
        if (cfg.tasks.length === 0) {
          ctx.ui.notify("No scheduled tasks", "info");
          return;
        }

        const lines: string[] = [];
        if (paused) lines.push("⚠ SCHEDULER PAUSED ⚠", "");
        lines.push(`Tasks (${cfg.tasks.length}):`, "");

        for (const t of cfg.tasks) {
          const status = t.enabled ? "✓" : "✗";
          const rt = resolvedTasks.get(t.id);
          const nextStr = rt
            ? new Date(rt.nextRunAt).toLocaleString()
            : t.enabled
              ? "pending..."
              : "disabled";
          lines.push(`  [${status}] ${t.id.slice(0, 8)}  ${t.schedule}`);
          lines.push(`         "${t.prompt.slice(0, 60)}${t.prompt.length > 60 ? "..." : ""}"`);
          lines.push(`         next: ${nextStr}`);
          lines.push("");
        }

        if (ctx.hasUI) {
          await ctx.ui.select("Scheduled Tasks", lines);
        } else {
          // Non-interactive: print lines
          for (const line of lines) {
            pi.sendMessage({ customType: "scheduler", content: line, display: true });
          }
        }
        return;
      }

      // REMOVE <id>
      const removeMatch = /^remove\s+(\S+)/i.exec(raw);
      if (removeMatch) {
        const idPrefix = removeMatch[1].toLowerCase();
        const cfg = loadConfig(ctx.cwd);
        const idx = cfg.tasks.findIndex((t) => t.id.toLowerCase().startsWith(idPrefix));
        if (idx < 0) {
          ctx.ui.notify(`Task not found: ${idPrefix}`, "error");
          return;
        }
        const removed = cfg.tasks[idx];
        cfg.tasks.splice(idx, 1);
        saveConfig(cfg);

        const rt = resolvedTasks.get(removed.id);
        if (rt?.timer) clearTimeout(rt.timer);
        resolvedTasks.delete(removed.id);

        ctx.ui.notify(`Removed: ${removed.id.slice(0, 8)} "${removed.prompt.slice(0, 40)}"`, "info");
        return;
      }

      // TOGGLE <id>
      const toggleMatch = /^toggle\s+(\S+)/i.exec(raw);
      if (toggleMatch) {
        const idPrefix = toggleMatch[1].toLowerCase();
        const cfg = loadConfig(ctx.cwd);
        const task = cfg.tasks.find((t) => t.id.toLowerCase().startsWith(idPrefix));
        if (!task) {
          ctx.ui.notify(`Task not found: ${idPrefix}`, "error");
          return;
        }
        task.enabled = !task.enabled;
        saveConfig(cfg);

        const rt = resolvedTasks.get(task.id);
        if (task.enabled && !rt && !paused) {
          scheduleTask(ctx, task);
        } else if (!task.enabled && rt?.timer) {
          clearTimeout(rt.timer);
          resolvedTasks.delete(task.id);
        }

        const status = task.enabled ? "enabled" : "disabled";
        ctx.ui.notify(`Task ${task.id.slice(0, 8)} ${status}`, "info");
        return;
      }

      // ADD <template>
      const addMatch = /^add\s+/i.exec(raw);
      if (addMatch) {
        const template = raw.slice(addMatch[0].length).trim();

        // Split on first | to get schedule and prompt
        const pipeIdx = template.indexOf("|");
        if (pipeIdx < 0) {
          ctx.ui.notify(
            'Format: /cron add <spec> | <prompt>\nExample: /cron add daily 09:00 | Status update',
            "error",
          );
          return;
        }

        const spec = template.slice(0, pipeIdx).trim();
        const promptText = template.slice(pipeIdx + 1).trim();

        if (!spec || !promptText) {
          ctx.ui.notify("Both schedule spec and prompt are required (separated by |)", "error");
          return;
        }

        const info = parseScheduleSpec(spec);
        if (!info) {
          ctx.ui.notify(
            `Invalid schedule spec: "${spec}"\nUse /cron help to see valid formats.`,
            "error",
          );
          return;
        }

        // Check minimum interval for periodic tasks
        if (info.type === "every" && info.intervalMs! < 30_000) {
          ctx.ui.notify("Minimum interval is 30 seconds", "error");
          return;
        }

        const task: ScheduledTask = {
          id: randomUUID(),
          schedule: spec,
          prompt: promptText,
          enabled: true,
          createdAt: new Date().toISOString(),
        };

        const cfg = loadConfig(ctx.cwd);
        cfg.tasks.push(task);
        saveConfig(cfg);

        if (!paused) scheduleTask(ctx, task);

        ctx.ui.notify(
          `Scheduled: ${spec} → "${promptText.slice(0, 50)}${promptText.length > 50 ? "..." : ""}"`,
          "info",
        );
        return;
      }

      // Unknown subcommand
      ctx.ui.notify(
        "Unknown subcommand. Use: add, list, remove, toggle, pause, resume, clear, help",
        "error",
      );
    },
  });
}
