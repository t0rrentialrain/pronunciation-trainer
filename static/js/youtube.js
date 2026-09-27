/* YouTube IFrame helpers + a small player factory.
   Used in two places: rough navigation on the Create tab, and the muted video
   reference during Practice. Each call to makeYTPlayer() controls one <div>. */

function fmtTime(sec) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
}
function fmtShort(sec) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function parseTime(str) {
  str = String(str).trim();
  if (str.includes(":")) {
    const [m, s] = str.split(":");
    return (parseInt(m, 10) || 0) * 60 + (parseFloat(s) || 0);
  }
  return parseFloat(str) || 0;
}
function parseVideoId(url) {
  url = url.trim();
  const patterns = [
    /[?&]v=([\w-]{11})/, /youtu\.be\/([\w-]{11})/,
    /\/embed\/([\w-]{11})/, /\/shorts\/([\w-]{11})/,
  ];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  if (/^[\w-]{11}$/.test(url)) return url;
  return null;
}

let _apiLoading = false;
const _apiWaiters = [];
function ensureYTAPI() {
  if (window.YT && window.YT.Player) return;
  if (!_apiLoading) {
    _apiLoading = true;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => {
      while (_apiWaiters.length) _apiWaiters.shift()();
    };
  }
}
function whenAPIReady(fn) {
  if (window.YT && window.YT.Player) fn();
  else { ensureYTAPI(); _apiWaiters.push(fn); }
}

function makeYTPlayer(divId) {
  let player = null, ready = false, pollTimer = null;
  const subs = { onReady: [], onTick: [] };

  function build(videoId) {
    player = new YT.Player(divId, {
      videoId,
      playerVars: { controls: 1, rel: 0, modestbranding: 1, playsinline: 1 },
      events: {
        onReady: () => {
          ready = true;
          if (pollTimer) clearInterval(pollTimer);
          pollTimer = setInterval(() => {
            if (ready) subs.onTick.forEach((cb) => cb(player.getCurrentTime(), player.getDuration()));
          }, 80);
          subs.onReady.forEach((cb) => cb(player.getDuration()));
        },
      },
    });
  }

  return {
    load(videoId) { whenAPIReady(() => (player ? player.loadVideoById(videoId) : build(videoId))); },
    duration: () => (ready ? player.getDuration() : 0),
    currentTime: () => (ready ? player.getCurrentTime() : 0),
    seek: (t) => ready && player.seekTo(t, true),
    play: () => ready && player.playVideo(),
    pause: () => ready && player.pauseVideo(),
    mute: () => ready && player.mute(),
    onReady: (cb) => { subs.onReady.push(cb); if (ready) cb(player.getDuration()); },
    onTick: (cb) => subs.onTick.push(cb),
    isReady: () => ready,
  };
}
