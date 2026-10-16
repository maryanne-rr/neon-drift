/**
 * startng.js
 * ----------
 * Everything this game knows about start.ng.
 *
 * start.ng hands your game two things for free:
 *   1. Who is playing (their name + the style of their start.ng character)
 *   2. A leaderboard
 *
 * We talk to start.ng through its hidden "connect" page with postMessage.
 * The reply is only trustworthy because we check which frame it came from
 * (see `askStartNg` below) - that is what makes it safe.
 */

const START_NG = 'https://start.ng';
const API = 'https://api.start.ng';

/** The hidden iframe that start.ng listens to. Created once, kept for the session. */
let framePromise = null;

function connectFrame() {
  framePromise ??= new Promise((resolve, reject) => {
    const el = document.createElement('iframe');
    el.src = `${START_NG}/connect`;
    el.hidden = true;
    el.onload = () => resolve(el);
    el.onerror = reject;
    document.body.append(el);
  });
  return framePromise;
}

/**
 * Sends a message to start.ng and resolves with its reply, or null if it stayed quiet.
 * @param {object} message   e.g. { type: 'startng:whoami' }
 * @param {string} replyType e.g. 'startng:user'
 */
export async function askStartNg(message, replyType, timeoutMs = 5000) {
  const el = await connectFrame();
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    const done = (reply) => {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(reply);
    };
    const timer = setTimeout(() => done(null), timeoutMs);

    function onMessage(event) {
      // Trust nothing that did not come from start.ng itself.
      if (event.origin !== START_NG || event.source !== el.contentWindow) return;
      if (event.data?.type === replyType && event.data.requestId === requestId) done(event.data);
    }

    addEventListener('message', onMessage);
    el.contentWindow.postMessage({ ...message, requestId }, START_NG);
  });
}

/** The look start.ng falls back to for players who have not signed in. */
export const GUEST_STYLE = {
  body: 'female',
  primaryColor: '#d8fd71',
  secondaryColor: '#3d5a3d',
  skinColor: '#8d5524',
  hairColor: '#17120f',
  hair: 'bun',
  hat: 'none',
  accessory: 'none',
};

/**
 * Who is playing right now?
 * @returns {Promise<{player: object, signedIn: boolean, face: string|null}>}
 */
export async function whoami() {
  const reply = await askStartNg({ type: 'startng:whoami' }, 'startng:user');
  const user = reply?.user ?? null;
  const guest = reply?.guest ?? null;
  const player = user ?? guest;

  if (!player) {
    // Opened outside start.ng (for example a local file). Play as the guest look.
    return { player: { name: 'Guest', account: null, style: GUEST_STYLE }, signedIn: false, face: null };
  }

  return {
    player: {
      id: user?.id ?? null,
      name: player.name ?? 'Guest',
      account: user?.account ?? null,
      style: { ...GUEST_STYLE, ...(player.style ?? {}) },
    },
    signedIn: Boolean(user),
    face: player.face ?? null,
  };
}

/** Where to send a player so start.ng can sign them in and bring them back here. */
export function signInUrl() {
  return `${START_NG}/?return_to=${encodeURIComponent(location.origin + location.pathname)}`;
}

/** Send the player off to sign in. */
export function goToSignIn() {
  location.href = signInUrl();
}

/**
 * Saves the finished run on start.ng. Only signed-in players can save.
 * @param {Record<string, number>} stats  must match the columns in startng.json
 */
export async function saveRun(stats) {
  return askStartNg({ type: 'startng:score', stats }, 'startng:scoreSaved');
}

/** The top players. Guests can read this too. */
export async function getLeaderboard(limit = 10) {
  const reply = await askStartNg({ type: 'startng:leaderboard', limit }, 'startng:leaderboardData');
  return reply?.entries ?? [];
}

/**
 * Calls back whenever the player signs in or out while the game is open.
 * (They may have switched tab to sign in on start.ng.)
 */
export function onPlayerChange(handler) {
  const check = () => {
    if (document.visibilityState === 'visible') handler();
  };
  document.addEventListener('visibilitychange', check);
  addEventListener('focus', check);
}