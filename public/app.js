(() => {
  const RECENT_LIMIT = 12;
  const els = {
    lang: document.getElementById('lang'),
    minViewers: document.getElementById('minViewers'),
    maxViewers: document.getElementById('maxViewers'),
    category: document.getElementById('category'),
    mature: document.getElementById('mature'),
    nextBtn: document.getElementById('nextBtn'),
    player: document.getElementById('player'),
    loading: document.getElementById('loading'),
    empty: document.getElementById('empty'),
    toast: document.getElementById('toast'),
    username: document.getElementById('username'),
    viewers: document.getElementById('viewers'),
    title: document.getElementById('title'),
    categoryLabel: document.getElementById('categoryLabel'),
    openKick: document.getElementById('openKick'),
    avatar: document.getElementById('avatar'),
    chat: document.getElementById('chat'),
    chatWrap: document.getElementById('chatWrap'),
  };

  const recent = [];
  let busy = false;
  let toastTimer = null;
  let chatEnabled = false;

  // Probe chat embed once; Kick often blocks X-Frame-Options so default to info panel
  function tryEnableChat(slug) {
    if (!slug) return;
    // Chat iframes are frequently blocked by Kick CSP / XFO.
    // Keep disabled by default; info panel is the reliable UX.
    els.chatWrap.hidden = true;
    els.chat.removeAttribute('src');
    chatEnabled = false;
  }

  function setLoading(on) {
    busy = on;
    els.nextBtn.disabled = on;
    els.loading.hidden = !on;
    if (on) els.empty.hidden = true;
  }

  function showToast(message, { retry = false } = {}) {
    clearTimeout(toastTimer);
    els.toast.hidden = false;
    els.toast.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = message;
    els.toast.appendChild(text);
    if (retry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Retry';
      btn.addEventListener('click', () => {
        els.toast.hidden = true;
        loadRandom();
      });
      els.toast.appendChild(btn);
    }
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, retry ? 12000 : 4500);
  }

  function formatViewers(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return String(v);
  }

  function updateInfo(stream) {
    els.username.textContent = stream.username || stream.slug || '—';
    els.viewers.textContent = `${formatViewers(stream.viewer_count)} viewers`;
    els.title.textContent = stream.title || 'Live on Kick';
    if (stream.category) {
      els.categoryLabel.hidden = false;
      els.categoryLabel.textContent = stream.category;
    } else {
      els.categoryLabel.hidden = true;
    }
    const url = stream.kick_url || (stream.slug ? `https://kick.com/${stream.slug}` : 'https://kick.com');
    els.openKick.href = url;
    if (stream.profilepic) {
      els.avatar.hidden = false;
      els.avatar.src = stream.profilepic;
      els.avatar.alt = stream.username || '';
    } else {
      els.avatar.hidden = true;
      els.avatar.removeAttribute('src');
    }
  }

  function remember(slug) {
    if (!slug) return;
    recent.push(slug.toLowerCase());
    while (recent.length > RECENT_LIMIT) recent.shift();
  }

  function buildQuery() {
    const params = new URLSearchParams();
    params.set('lang', els.lang.value || 'en');
    params.set('minViewers', String(Math.max(0, parseInt(els.minViewers.value, 10) || 0)));
    const max = els.maxViewers.value.trim();
    if (max !== '') params.set('maxViewers', max);
    params.set('mature', els.mature.checked ? 'true' : 'false');
    const cat = els.category.value.trim();
    if (cat) params.set('category', cat);
    if (recent.length) params.set('exclude', recent.join(','));
    return params.toString();
  }

  async function loadRandom() {
    if (busy) return;
    setLoading(true);
    els.toast.hidden = true;

    try {
      const res = await fetch(`/api/random?${buildQuery()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      if (!data.slug) {
        throw new Error('No stream slug in response');
      }

      remember(data.slug);
      updateInfo(data);
      els.player.src = `https://player.kick.com/${encodeURIComponent(data.slug)}?autoplay=true`;
      els.empty.hidden = true;
      tryEnableChat(data.slug);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to load a stream', { retry: true });
      if (!els.player.src) els.empty.hidden = false;
    } finally {
      setLoading(false);
    }
  }

  els.nextBtn.addEventListener('click', () => loadRandom());

  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.code === 'Space' || e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      loadRandom();
    }
  });

  // Persist language preference lightly
  const savedLang = localStorage.getItem('kr_lang');
  if (savedLang) els.lang.value = savedLang;
  els.lang.addEventListener('change', () => {
    localStorage.setItem('kr_lang', els.lang.value);
  });

  loadRandom();
})();
