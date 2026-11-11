# Design notes

Why I built it the way I did, what I traded away, and what I would change if this had to grow.

## Why keep a list of events instead of just updating rows?

The usual way is to have a `cases` table and run `UPDATE` on it. I store events instead ("case moved", "wheels in") and build the board by replaying them.

What I get:

- **Time travel.** Stop the replay early and you see the past. No extra code.
- **An audit trail.** In a hospital, "who moved this case and when" is a question people really ask.
- **Simple sync.** A browser only needs "send me every event after number 212". Each event has a number with no gaps, so a browser can tell when it missed one and reload.
- **One reducer everywhere.** `applyEvent(state, event)` is a pure function. The server, the browser and the tests all use the same one.

What it costs:

- Reading the current state means replaying. A day is about 300 to 400 events, so that is nothing here. With years of history I would save a snapshot every so often and replay from there.
- I still keep a normal `cases` table next to the events, because the database needs real rows to enforce the no overlap rule. A test checks that the table and the events always agree.

## Why one big lock for writes?

Every write takes the same Postgres advisory lock. So writes happen one at a time, even across servers.

That sounds slow, but a write is tiny, and it makes the hard things easy:

- Event numbers come out in order with no gaps.
- The server can keep the board in memory. When it gets the lock it reads only the events it has not seen yet, and then its copy is exactly right.
- An emergency bump can move five cases at once and nobody sees a half finished shuffle.

In the load test this handled about 770 write requests a second. One hospital has maybe a few writes a minute.

If I needed more: lock per board (per hospital, per day) instead of one global lock. Boards do not affect each other, so they do not need to wait for each other.

## Why is the database rule there if the lock already works?

Because I do not trust myself. The lock protects against races. The `EXCLUDE` constraint protects against bugs in my own rule checks, and against anyone who writes to the table without going through the app. One test does exactly that.

The constraints are `DEFERRABLE INITIALLY DEFERRED`. That means Postgres checks them at commit, not after each statement. A bump moves several cases, and halfway through two of them may briefly overlap. Only the end result has to be clean.

## Two kinds of "someone else got there first"

1. **Same slot.** Two people drop different cases on the same room and time. The second one fails the overlap check. Answer: 409 conflict.
2. **Same case.** Two people move the same case. Each case has a version number that goes up on every change. A request carries the version the person was looking at. If it is old, the request is refused. Answer: 409 stale. This is called optimistic concurrency. Nobody holds a lock while they think, and you only find out at the end if you lost.

## How repair works

Repair is the function that fixes the schedule after something changed. It is used for emergencies, for surgeries that run long, and for late starts.

1. Put the changed cases in a min heap, ordered by start time.
2. Pop the earliest one.
3. If it is allowed to move and something earlier (or something that can not move) is in its way, push it to just after that thing. Put it back in the heap.
4. Otherwise it stays. Every movable case that clashes with it gets pushed to just after it, and goes in the heap.
5. Repeat until the heap is empty.

A clash is either "same room, less than 15 minutes apart" (cleaning time) or "same surgeon, less than 10 minutes apart".

It always finishes because cases only ever move later. It never moves a case that already started.

The interval tree makes step 3 and 4 fast: finding the cases that touch a time range takes about log n steps plus the number of hits, instead of checking every case.

Honest note: with 40 cases a plain loop would be just as fast. I wrote the tree because it is the right tool once a board has thousands of cases (a whole health network, or weeks of schedule), and because I wanted to build one properly, with a test that compares it to the plain loop.

## Is the bump planner optimal?

No. It is greedy. For each room it places the emergency at the earliest possible time and lets repair push things later. It never tries moving a case to a different room, or swapping two cases, which could sometimes be cheaper.

The true problem is a version of job shop scheduling, which is NP hard. A better version would try a small search around the greedy answer: for each bumped case, check whether another room has a free gap.

The cost weights (8, 1, 3, 2) are my own guesses. A real hospital would set them, and would argue about them.

## Why Redis if Postgres has LISTEN/NOTIFY?

Fair question. For this size, `LISTEN/NOTIFY` would work and would mean one less thing to run. I used Redis pub/sub because it is the standard answer for fanning out WebSocket messages across servers, messages can be any size (NOTIFY payloads are capped at 8000 bytes, and a day seed event is bigger than that), and it keeps that traffic off the database.

Redis is optional. With no `REDIS_URL` the server uses an in memory bus, which is fine for a single server.

If Redis drops a message, nothing breaks. Event numbers have no gaps, so a browser that sees number 215 after 213 knows it missed one and reloads the day.

## Who runs the clock?

The simulator must run in exactly one place or time would go double speed. Each server tries to grab a second advisory lock on a dedicated connection. Whoever gets it is the leader and ticks the clock four times a second. If that server dies its connection closes, Postgres drops the lock, and another server picks it up on its next tick. There is a test for the "two servers, single speed" part.

## Why does the demo not need a server?

All the rules are in `packages/core`, which is plain TypeScript with zero dependencies. The server wraps it with a database. The browser demo wraps it with a `setInterval`. Same simulator, same planner, same reducer.

The same trick lets the board check a drag before you drop it, using the same interval tree the server uses. The server still makes the final call.

## What I would do next

- **Login and roles.** A coordinator can move cases, a surgeon can only look.
- **Pull forward.** When a case ends early, offer to move the next one up.
- **Room and staff constraints.** Not every room can do cardiac surgery. Anesthetists and nurses are limited too.
- **Predict durations.** The simulator knows how long each case will really take and the board does not. A model trained on past cases could give better block lengths. That would tie this back to my ML work.
- **Snapshots** so replay stays fast with a long history.
- **Keyboard moves.** Dragging needs a mouse or a finger right now.
