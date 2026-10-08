# cache-keeper

A Claude Code mod for long conversations you walk away from. The prompt cache goes cold after 60 idle minutes, and re-caching a 300k-token conversation is expensive. cache-keeper keeps it warm once, then hands you a clean way to continue.

After Claude finishes a reply, an idle clock starts:

1. At 50 minutes it replays the conversation with a one-word question, so the API reads it from the cache and the 60-minute window starts over. You pay the cached-read price, not a re-cache.
2. At 100 minutes, while the cache is still warm from that read, it asks for a handoff doc (goal, current state, next step, decisions, open questions, suggested skills) and saves it to `$TMPDIR/handoff-<session>-<time>.md`.
3. It posts the path and a ready-to-paste prompt in the chat and copies that prompt to your clipboard. `/clear` (or open a new window) and paste.

Any new message resets the clock, and `/clear` stops it. The ping and the handoff request never enter the transcript. The status line shows when the next step is due.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install cache-keeper --marketplace razzamatazm/cache-keeper
```

Answer `y` to add the marketplace, then press Enter to pick the user scope.

## Develop

```
claude plugin validate .
claude plugin test .
```

The timings are `PING_AFTER_MS` and `HANDOFF_AFTER_MS` at the top of `hooks/register.ts`.
