(function () {
  "use strict";

  const root = document.documentElement;
  const audio = document.getElementById('player');
  const track = document.getElementById('lyrics-track');
  const startOverlay = document.getElementById('start-overlay');
  const cursorDot = document.getElementById('cursor-dot');
  const cursorGlow = document.getElementById('cursor-glow');

  let songs = [];
  let queue = [];
  let currentSong = null;
  let currentLyrics = [];
  let activeIndex = -1;

  // ---------------- cursor / flashlight following ----------------
  function moveLight(x, y) {
    root.style.setProperty('--mx', x + 'px');
    root.style.setProperty('--my', y + 'px');
    cursorDot.style.setProperty('--px', x + 'px');
    cursorDot.style.setProperty('--py', y + 'px');
    cursorGlow.style.setProperty('--px', x + 'px');
    cursorGlow.style.setProperty('--py', y + 'px');
  }

  window.addEventListener('mousemove', e => moveLight(e.clientX, e.clientY));
  window.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (t) moveLight(t.clientX, t.clientY);
  }, { passive: true });

  moveLight(window.innerWidth / 2, window.innerHeight / 2);

  // ---------------- LRC parsing ----------------
  function parseLRC(text) {
    const timeExp = /\[(\d{2}):(\d{2}(?:\.\d{1,2})?)\]/g;
    const lines = text.split('\n');
    const result = [];

    for (const raw of lines) {
      const times = [];
      let match;
      timeExp.lastIndex = 0;
      while ((match = timeExp.exec(raw))) {
        times.push(parseInt(match[1], 10) * 60 + parseFloat(match[2]));
      }
      if (times.length === 0) continue;
      const text = raw.replace(timeExp, '').trim();
      if (!text) continue;
      times.forEach(t => result.push({ time: t, text }));
    }
    result.sort((a, b) => a.time - b.time);
    return result;
  }

  // ---------------- lyric fetching (lrclib.net, client-side, free) ----------------
  async function fetchLyricsFor(song) {
    const cacheKey = 'lyriccache:' + song.artist + '::' + song.title;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { /* corrupt cache, ignore */ }
    }

    const params = new URLSearchParams({ track_name: song.title });
    if (song.artist) params.set('artist_name', song.artist);

    try {
      const res = await fetch('https://lrclib.net/api/search?' + params.toString());
      if (!res.ok) throw new Error('lrclib request failed');
      const results = await res.json();
      if (!Array.isArray(results) || results.length === 0) {
        localStorage.setItem(cacheKey, JSON.stringify(null));
        return null;
      }

      const best = results.find(r => r.syncedLyrics) || results[0];
      const data = {
        synced: best.syncedLyrics || null,
        plain: best.plainLyrics || null
      };
      localStorage.setItem(cacheKey, JSON.stringify(data));
      return data;
    } catch (e) {
      console.warn('Lyric lookup failed:', e);
      return null;
    }
  }

  // ---------------- rendering ----------------
  function renderLyrics(lines, state) {
    track.innerHTML = '';
    activeIndex = -1;

    if (state === 'loading') {
      const div = document.createElement('div');
      div.className = 'lyric-line placeholder';
      div.textContent = 'searching for lyrics…';
      track.appendChild(div);
      return;
    }
    if (state === 'none' || lines.length === 0) {
      const div = document.createElement('div');
      div.className = 'lyric-line placeholder';
      div.textContent = 'no lyrics found for this one';
      track.appendChild(div);
      return;
    }

    lines.forEach(line => {
      const div = document.createElement('div');
      div.className = 'lyric-line';
      div.textContent = line.text;
      track.appendChild(div);
    });
  }

  function updateActiveLine() {
    if (currentLyrics.length === 0) return;
    const t = audio.currentTime;
    let idx = -1;
    for (let i = 0; i < currentLyrics.length; i++) {
      if (currentLyrics[i].time <= t) idx = i;
      else break;
    }
    if (idx === activeIndex) return;
    activeIndex = idx;

    const children = track.children;
    for (let i = 0; i < children.length; i++) {
      children[i].classList.toggle('active', i === idx);
    }
    if (idx >= 0 && children[idx]) {
      const targetOffset = children[idx].offsetTop + children[idx].offsetHeight / 2;
      const trackHeight = track.scrollHeight;
      track.style.transform = `translate(-50%, calc(-50% - ${targetOffset - trackHeight / 2}px))`;
    }
  }

  // build naive evenly-spaced timings when only plain (unsynced) lyrics exist
  function buildNaiveTimings(plainText) {
    const lines = plainText.split('\n').map(l => l.trim()).filter(Boolean);
    const dur = (audio.duration && isFinite(audio.duration)) ? audio.duration : 180;
    const pad = Math.min(3, dur * 0.05);
    const start = pad;
    const span = Math.max(dur - pad * 2, 1);
    return lines.map((text, i) => ({
      time: start + (span * i / lines.length),
      text
    }));
  }

  // ---------------- playback / shuffle ----------------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function freshQueue(avoidFirst) {
    let a = shuffle(songs);
    if (a.length > 1 && avoidFirst && a[0].file === avoidFirst.file) {
      const j = 1 + Math.floor(Math.random() * (a.length - 1));
      [a[0], a[j]] = [a[j], a[0]];
    }
    return a;
  }

  async function loadSong(song) {
    currentSong = song;
    document.title = song.title || 'now playing';
    audio.src = song.file;
    currentLyrics = [];
    renderLyrics([], 'loading');

    audio.play().catch(() => {});

    const data = await fetchLyricsFor(song);

    // song may have changed (user skipped) while we were fetching
    if (currentSong !== song) return;

    if (data && data.synced) {
      currentLyrics = parseLRC(data.synced);
      renderLyrics(currentLyrics);
    } else if (data && data.plain) {
      const applyNaive = () => {
        if (currentSong !== song) return;
        currentLyrics = buildNaiveTimings(data.plain);
        renderLyrics(currentLyrics);
      };
      if (audio.readyState >= 1 && isFinite(audio.duration)) {
        applyNaive();
      } else {
        audio.addEventListener('loadedmetadata', applyNaive, { once: true });
      }
    } else {
      renderLyrics([], 'none');
    }
  }

  function playNext() {
    if (queue.length === 0) {
      queue = freshQueue(currentSong);
    }
    const next = queue.shift();
    loadSong(next);
  }

  audio.addEventListener('ended', playNext);
  audio.addEventListener('timeupdate', updateActiveLine);

  // ---------------- invisible controls ----------------
  window.addEventListener('keydown', e => {
    if (e.code === 'Space') {
      e.preventDefault();
      audio.paused ? audio.play() : audio.pause();
    } else if (e.code === 'ArrowRight') {
      playNext();
    } else if (e.code === 'ArrowUp') {
      audio.volume = Math.min(1, audio.volume + 0.1);
    } else if (e.code === 'ArrowDown') {
      audio.volume = Math.max(0, audio.volume - 0.1);
    }
  });

  // ---------------- boot ----------------
  async function init() {
    const res = await fetch('songs.php');
    songs = await res.json();
    if (songs.length === 0) return;
    queue = freshQueue(null);
  }

  init();

  startOverlay.addEventListener('click', () => {
    startOverlay.classList.add('hidden');
    if (queue.length > 0) playNext();
  }, { once: true });

})();
