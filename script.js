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

  // start centered
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

  function renderLyrics(lines) {
    track.innerHTML = '';
    activeIndex = -1;
    if (lines.length === 0) {
      const div = document.createElement('div');
      div.className = 'lyric-line placeholder';
      div.textContent = 'no lyrics for this one';
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
    document.title = song.title;
    audio.src = song.file;

    currentLyrics = [];
    renderLyrics([]);

    if (song.lyrics) {
      try {
        const res = await fetch(song.lyrics);
        if (res.ok) {
          const text = await res.text();
          currentLyrics = parseLRC(text);
          renderLyrics(currentLyrics);
        }
      } catch (e) { /* no lyrics, that's fine */ }
    }

    audio.play().catch(() => {});
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
