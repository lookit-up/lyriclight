(function () {
  "use strict";

  const root = document.documentElement;
  const audio = document.getElementById('player');
  const track = document.getElementById('lyrics-track');
  const startOverlay = document.getElementById('start-overlay');
  const startText = document.getElementById('start-text');
  const cursorGlow = document.getElementById('cursor-glow');
  const uploadZone = document.getElementById('upload-zone');
  const uploadBtn = document.getElementById('upload-btn');
  const uploadInput = document.getElementById('upload-input');
  const clearUploadsBtn = document.getElementById('clear-uploads-btn');

  let songs = [];
  let queue = [];
  let currentSong = null;
  let currentLyrics = [];
  let activeIndex = -1;
  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;

  const FADE = 230; // must match --fade in CSS

  // ---------------- cursor / flashlight following ----------------
  function moveLight(x, y) {
    mouseX = x; mouseY = y;
    root.style.setProperty('--mx', x + 'px');
    root.style.setProperty('--my', y + 'px');
    cursorGlow.style.setProperty('--px', x + 'px');
    cursorGlow.style.setProperty('--py', y + 'px');
    updateUploadVisibility();
  }
  window.addEventListener('mousemove', e => moveLight(e.clientX, e.clientY));
  window.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (t) moveLight(t.clientX, t.clientY);
  }, { passive: true });
  moveLight(mouseX, mouseY);

  // upload zone visibility is driven by JS distance-check, NOT a shared css mask,
  // so it's never subject to browsers blocking clicks on masked-out areas
  function updateUploadVisibility() {
    const rect = uploadZone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(mouseX - cx, mouseY - cy);
    uploadZone.classList.toggle('lit', dist < FADE);
  }
  window.addEventListener('resize', updateUploadVisibility);

  // ================= IndexedDB (local-only upload storage) =================
  const DB_NAME = 'flashlight-player';
  const STORE = 'uploads';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbAdd(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGetAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbClear() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ================= ID3 tag auto-detection =================
  function readTags(source) {
    return new Promise((resolve) => {
      if (!window.jsmediatags) { resolve(null); return; }
      window.jsmediatags.read(source, {
        onSuccess: (tag) => {
          const t = tag.tags || {};
          resolve({ artist: (t.artist || '').trim(), title: (t.title || '').trim() });
        },
        onError: () => resolve(null)
      });
    });
  }
  async function resolveMeta(song) {
    if (song.metaResolved) return song;
    const source = song.source === 'local' ? song.blob : song.file;
    const tags = await readTags(source);
    if (tags && (tags.artist || tags.title)) {
      if (tags.artist) song.artist = tags.artist;
      if (tags.title) song.title = tags.title;
    }
    song.metaResolved = true;
    return song;
  }

  // ================= LRC parsing =================
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

  // ================= lyric fetching (lrclib.net) =================
  async function fetchLyricsFor(song) {
    const cacheKey = 'lyriccache:' + song.artist + '::' + song.title;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) {}
    }
    const params = new URLSearchParams({ track_name: song.title || song.name });
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
      const data = { synced: best.syncedLyrics || null, plain: best.plainLyrics || null };
      localStorage.setItem(cacheKey, JSON.stringify(data));
      return data;
    } catch (e) {
      console.warn('Lyric lookup failed:', e);
      return null;
    }
  }

  // ================= rendering =================
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

  function buildNaiveTimings(plainText) {
    const lines = plainText.split('\n').map(l => l.trim()).filter(Boolean);
    const dur = (audio.duration && isFinite(audio.duration)) ? audio.duration : 180;
    const pad = Math.min(3, dur * 0.05);
    const start = pad;
    const span = Math.max(dur - pad * 2, 1);
    return lines.map((text, i) => ({ time: start + (span * i / lines.length), text }));
  }

  // ================= playback / shuffle =================
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
    audio.src = song.file;
    currentLyrics = [];
    renderLyrics([], 'loading');
    audio.play().catch(err => console.warn('Playback blocked:', err));

    await resolveMeta(song);
    document.title = song.title || song.name || 'now playing';
    if (currentSong !== song) return;

    const data = await fetchLyricsFor(song);
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
      if (audio.readyState >= 1 && isFinite(audio.duration)) applyNaive();
      else audio.addEventListener('loadedmetadata', applyNaive, { once: true });
    } else {
      renderLyrics([], 'none');
    }
  }

  function playNext() {
    if (queue.length === 0) queue = freshQueue(currentSong);
    const next = queue.shift();
    loadSong(next);
  }

  audio.addEventListener('ended', playNext);
  audio.addEventListener('timeupdate', updateActiveLine);
  audio.addEventListener('error', () => {
    console.error('Audio failed to load:', audio.src);
  });

  // ================= invisible controls =================
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

  // ================= uploads (local-only, IndexedDB) =================
  function songFromUploadRecord(record) {
    const url = URL.createObjectURL(record.blob);
    return {
      source: 'local',
      id: record.id,
      file: url,
      blob: record.blob,
      name: record.name,
      artist: '',
      title: record.name.replace(/\.[^.]+
