# Trigger sources

A scheduled job runs when its **trigger** fires. Until 0.4 the only trigger was a
clock, so "every weekday at 09:00" was expressible and "when the release meeting
starts" or "when the schema changes" were not — both of which are scheduling, and
neither of which is a time.

```jsonc
// ~/.deepcode/cron.json
{
  "jobs": [
    { "id": "nightly", "schedule": "0 3 * * *", "prompt": "…", "cwd": "/repo" },

    {
      "id": "release-prep",
      "trigger": { "kind": "ics", "path": "team.ics", "match": "release" },
      "prompt": "Run the release checklist",
      "cwd": "/repo",
    },

    {
      "id": "regen",
      "trigger": { "kind": "file", "paths": ["schema.json"] },
      "prompt": "Regenerate the client from schema.json",
      "cwd": "/repo",
    },
  ],
}
```

`schedule` still works and still means cron. A job written before triggers
existed needs no migration — a store nobody has to rewrite cannot be rewritten
wrongly.

## Everything is polled

`deepcode scheduler run` already wakes on a timer and asks what is due. Every
trigger answers that same question, so there is no daemon, no watcher process,
and no way for a trigger to fire while nothing is listening.

The cost is **minute granularity** for all of them, which is the granularity you
can observe anyway: a trigger resolvable to the second would fire or not
depending on how promptly launchd got around to it.

## `cron`

```jsonc
{ "kind": "cron", "schedule": "0 9 * * 1-5" }
```

Five fields: minute, hour, day-of-month, month, day-of-week.

## `ics` — a calendar file

```jsonc
{ "kind": "ics", "path": "team.ics", "match": "release" }
```

Fires in the minute a matching event **starts**. `match` is a case-insensitive
substring of the event summary; without it, every event in the file fires the
job.

**Standard iCalendar text is the only calendar input.** No vendor SDK, no OAuth
to anybody's calendar service, no remote account polling. Every calendar worth
integrating with exports `.ics`, and a file on disk is a boundary you can
inspect — which a vendor client library is not. Point the path at an export, a
synced file, or something your own tooling writes.

### What the reader supports

| Construct                      | Behaviour                                            |
| ------------------------------ | ---------------------------------------------------- |
| `DTSTART` UTC (`…Z`)           | Used as written                                      |
| `DTSTART` floating (no zone)   | Read as UTC                                          |
| `DTSTART;VALUE=DATE` (all-day) | **Never fires** — see below                          |
| `SUMMARY`, incl. folded lines  | Used for `match`                                     |
| `RRULE FREQ=DAILY` / `=WEEKLY` | Expanded, with `INTERVAL`, `BYDAY`, `UNTIL`, `COUNT` |
| Anything else                  | **Reported**, never silently dropped                 |

Unsupported constructs are logged next to the job that hit them. A silently
ignored `RRULE` is a job that never fires, and that failure looks exactly like
"nothing was scheduled" — which is the one thing it must not be mistaken for.

`TZID` is reported rather than honoured. DeepCode carries no timezone database,
and quietly applying the host's zone would make the same file fire at different
moments on different machines.

**All-day entries never fire.** They name a day, not a moment; choosing one
(midnight? 09:00?) would be DeepCode inventing a schedule you did not write. Use
a `cron` trigger if you want a time.

## `file` — something changed

```jsonc
{ "kind": "file", "paths": ["schema.json", "proto/"] }
```

Fires when any listed path's modification time is newer than the job's last run.
Relative paths resolve against the job's `cwd`.

Two behaviours worth knowing:

- **The first evaluation never fires.** It records a baseline instead. Otherwise
  every file trigger would fire the moment it was created, on files nobody had
  touched since anyone cared.
- **A missing path is not a change.** A watched file may simply not have been
  generated yet, and reporting that every minute would bury the messages that
  matter.

## Permissions are unchanged

A trigger decides _when_, never _what may happen_. Every scheduled run still goes
through the [trigger profile](FLOATBOAT_ADOPTION_PLAN.md) clamp: a permissive
`permissions.defaultMode` inherited from interactive settings is reduced to
`default` unless the job sets `profile.mode` explicitly, and a call needing
approval is refused because nobody is present to give it.

A calendar you do not control deciding _when_ DeepCode runs is already worth
thinking about. It must never also decide what it may do.
