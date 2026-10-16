# Neon Drift

A 3D kart racer for [start.ng](https://start.ng), built with three.js.

Three laps of a 630 metre circuit against three computer karts. You brake for
the corners, fight for the racing line and try to beat your own best lap.

**You drive as yourself.** The driver in your kart is your start.ng character -
the same colours, hair, hat and accessory you have on start.ng.

## Why the character comes from start.ng

The game never asks the player to choose a look. On load it asks start.ng who is
playing and gets back a `style` object:

```js
{ body: 'female', primaryColor: '#a55eea', secondaryColor: '#0c6e5a',
  skinColor: '#8d5524', hairColor: '#17120f', hair: 'braids',
  hat: 'crown', accessory: 'earrings' }
```

`js/character.js` turns that into the 3D character, and `js/kart.js` sits them in
the kart. Change your character on start.ng and it changes here too - in every
game on the platform.

Sign-in, the leaderboard and the multiplayer rooms belong to start.ng as well.
This game has no server, no database and never sees anyone's password or email.

## Run it locally

The game is plain HTML, CSS and JavaScript. **There is no build step**, so any
static server works:

```bash
npx serve .            # or: python -m http.server 4173
```

Opened locally, start.ng will not answer (it only replies to games served from a
`*.start.ng` address), so the game falls back to the guest character and will
not save times. That is expected - the leaderboard only works once the game is
live.

## Controls

| | |
| --- | --- |
| Steer | <kbd>A</kbd> <kbd>D</kbd> or <kbd>&larr;</kbd> <kbd>&rarr;</kbd> |
| Throttle | <kbd>W</kbd> or <kbd>&uarr;</kbd> |
| Brake | <kbd>S</kbd> or <kbd>&darr;</kbd> |
| Race again | <kbd>R</kbd> or <kbd>Enter</kbd> |

On a phone or tablet there are on-screen buttons.

Going off the track is slow, so brake *before* the corner: the speed limit for
each bend is worked out from how tight it is.

## Files

| Path | What it does |
| --- | --- |
| `index.html` | The page: canvas, HUD, leaderboard, results panel |
| `styles.css` | HUD styling |
| `js/main.js` | Scene, the grid, laps, timing, camera, HUD, scoring |
| `js/track.js` | The circuit as pure numbers: spline, lap maths, car handling |
| `js/world.js` | Draws the road, barriers, scenery and sky |
| `js/kart.js` | The karts, built from boxes and cylinders |
| `js/character.js` | Builds the 3D character from a start.ng `style` |
| `js/startng.js` | Every conversation with start.ng (whoami, scores, board) |
| `tests/track.test.mjs` | Unit tests for the circuit and the handling |
| `startng.json` | The leaderboard column: best lap, fastest wins |
| `vendor/three.module.min.js` | three.js r169, committed so nothing loads from a CDN |
| `cover.png` | The card picture on start.ng (16:10) |

### Why `track.js` is separate

The circuit is the part of a racing game that is easy to get subtly wrong and
hard to see on screen, so it is plain arithmetic with no three.js and no DOM,
which means it can be tested directly:

```bash
npm test
```

19 tests cover the spline (the loop closes, it never crosses itself, tangents
stay square to the road), the speed limits (corner speeds stay inside the car's
limits, you can always brake in time) and the handling (throttle, brakes,
steering settles when you let go, gravel is slow, laps only count once).

## The leaderboard

`startng.json` declares one column:

| Column | Order |
| --- | --- |
| Best lap | lowest (fastest) |

Only signed-in players can save a lap, and only their fastest is kept. The
leaderboard accepts whole seconds, so the saved time is rounded; the HUD shows
your lap to a tenth of a second. Your own personal best is also kept in
`localStorage`, so you can see it even when signed out.

## Publish it to start.ng

The game goes live from a **public GitHub repo**. Push this folder to one, then:

```bash
# 1. check the repo without publishing anything
curl -X POST https://api.start.ng/games/check \
  -H "Content-Type: application/json" \
  -d '{"repo_url":"https://github.com/YOUR-USERNAME/neon-drift","name":"neon-drift"}'

# 2. publish
curl -X POST https://api.start.ng/games/publish \
  -H "Content-Type: application/json" \
  -d '{"repo_url":"https://github.com/YOUR-USERNAME/neon-drift","name":"neon-drift"}'
```

`check` lists every problem at once (`errors` stop it going live, `warnings` are
worth fixing). `publish` replies with an `approve_url` - open it while signed in
to start.ng and the game is live at `https://neon-drift.start.ng`.

After that, every push to the published branch updates the game by itself.

## Licence

The game code is free to use. three.js is included under its own MIT licence
(see the header of `vendor/three.module.min.js`).