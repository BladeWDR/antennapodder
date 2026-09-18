// AntennaPodder Companion Web Application

(function () {
  'use strict';

  // Application State
  const state = {
    user: null,
    config: {
      skip_forward_sec: 30,
      skip_back_sec: 10,
      theme: 'mocha'
    },
    subscriptions: [],
    currentPodcast: null,
    currentEpisodes: [],
    activeEpisode: null,
    activePodcast: null,
    isPlaying: false,
    isVideo: false,
    playbackRate: 1.0,
    volume: 1.0,
    isMuted: false,
    filter: 'all',
    searchQuery: '',
    podcastSort: localStorage.getItem('antennapodder_podcast_sort') || 'recent',
    podcastFilter: 'all',
    librarySearchQuery: '',
    syncInterval: null,
    multiSelectMode: false,
    selectedEpisodeIds: new Set()
  };

  // DOM Elements
  const el = {
    // Views
    viewLibrary: document.getElementById('view-library'),
    viewPodcast: document.getElementById('view-podcast'),
    viewSettings: document.getElementById('view-settings'),

    // Nav
    brand: document.getElementById('nav-brand'),
    btnNavLibrary: document.getElementById('btn-nav-library'),
    btnNavSettings: document.getElementById('btn-nav-settings'),
    btnOpenAdd: document.getElementById('btn-open-add'),
    btnThemeToggle: document.getElementById('btn-theme-toggle'),
    themeIconMoon: document.getElementById('theme-icon-moon'),
    themeIconSun: document.getElementById('theme-icon-sun'),
    btnLogout: document.getElementById('btn-logout'),

    // Library
    podcastSearchInput: document.getElementById('podcast-search-input'),
    podcastSortSelect: document.getElementById('podcast-sort-select'),
    filterPodAll: document.getElementById('filter-pod-all'),
    filterPodFavs: document.getElementById('filter-pod-favs'),
    continueSection: document.getElementById('continue-listening-section'),
    continueGrid: document.getElementById('continue-listening-grid'),
    libraryGrid: document.getElementById('library-grid'),
    libraryEmpty: document.getElementById('library-empty'),
    libraryEmptyTitle: document.getElementById('library-empty-title'),
    libraryEmptyDesc: document.getElementById('library-empty-desc'),
    btnEmptyClearSearch: document.getElementById('btn-empty-clear-search'),
    btnEmptyAdd: document.getElementById('btn-empty-add'),
    btnRefreshAll: document.getElementById('btn-refresh-all'),

    // Podcast Detail
    btnPodcastBack: document.getElementById('btn-podcast-back'),
    detailArt: document.getElementById('detail-art'),
    detailTitle: document.getElementById('detail-title'),
    detailAuthor: document.getElementById('detail-author'),
    detailDesc: document.getElementById('detail-desc'),
    btnPodcastFavorite: document.getElementById('btn-podcast-favorite'),
    iconPodcastFav: document.getElementById('icon-podcast-fav'),
    textPodcastFav: document.getElementById('text-podcast-fav'),
    btnPodcastMarkAllPlayed: document.getElementById('btn-podcast-mark-all-played'),
    btnPodcastRefresh: document.getElementById('btn-podcast-refresh'),
    btnPodcastUnsubscribe: document.getElementById('btn-podcast-unsubscribe'),
    episodesList: document.getElementById('episodes-list'),
    episodeSearchInput: document.getElementById('episode-search-input'),
    filterBtns: document.querySelectorAll('.filter-btn'),
    btnToggleMultiSelect: document.getElementById('btn-toggle-multi-select'),
    textToggleMultiSelect: document.getElementById('text-toggle-multi-select'),
    episodesBatchBar: document.getElementById('episodes-batch-bar'),
    batchSelectedCount: document.getElementById('batch-selected-count'),
    btnBatchSelectAll: document.getElementById('btn-batch-select-all'),
    btnBatchDeselectAll: document.getElementById('btn-batch-deselect-all'),
    btnBatchMarkPlayed: document.getElementById('btn-batch-mark-played'),
    btnBatchCancel: document.getElementById('btn-batch-cancel'),

    // Media Elements
    nativeAudio: document.getElementById('native-audio'),
    nowplayingVideo: document.getElementById('nowplaying-video'),
    nowplayingVideoWrapper: document.getElementById('nowplaying-video-wrapper'),

    // Bottom Player Bar
    playerBar: document.getElementById('player-bar'),
    playerTrackClick: document.getElementById('player-track-click'),
    playerThumb: document.getElementById('player-thumb'),
    playerTitle: document.getElementById('player-title'),
    playerPodcast: document.getElementById('player-podcast'),
    btnPlayPause: document.getElementById('btn-play-pause'),
    iconPlay: document.getElementById('icon-play'),
    iconPause: document.getElementById('icon-pause'),
    btnPrevTrack: document.getElementById('btn-prev-track'),
    btnNextTrack: document.getElementById('btn-next-track'),
    btnSkipBack: document.getElementById('btn-skip-back'),
    btnSkipForward: document.getElementById('btn-skip-forward'),
    badgeSkipBack: document.getElementById('badge-skip-back'),
    badgeSkipForward: document.getElementById('badge-skip-forward'),
    playerTimeCurrent: document.getElementById('player-time-current'),
    playerTimeTotal: document.getElementById('player-time-total'),
    playerScrubber: document.getElementById('player-scrubber'),
    playerSpeed: document.getElementById('player-speed'),
    volumeSlider: document.getElementById('volume-slider'),
    btnVolumeToggle: document.getElementById('btn-volume-toggle'),
    iconVolHigh: document.getElementById('icon-vol-high'),
    iconVolMute: document.getElementById('icon-vol-mute'),
    btnExpandNowplaying: document.getElementById('btn-expand-nowplaying'),
    btnPlayerFullscreenVideo: document.getElementById('btn-player-fullscreen-video'),

    // Now Playing Modal
    modalNowPlaying: document.getElementById('modal-now-playing'),
    btnCloseNowplaying: document.getElementById('btn-close-nowplaying'),
    btnVideoOverlayFullscreen: document.getElementById('btn-video-overlay-fullscreen'),
    nowplayingArt: document.getElementById('nowplaying-art'),
    nowplayingTitle: document.getElementById('nowplaying-title'),
    nowplayingPodcast: document.getElementById('nowplaying-podcast'),
    nowplayingTimeCurrent: document.getElementById('nowplaying-time-current'),
    nowplayingTimeTotal: document.getElementById('nowplaying-time-total'),
    nowplayingScrubber: document.getElementById('nowplaying-scrubber'),
    btnModalPlayPause: document.getElementById('btn-modal-play-pause'),
    modalIconPlay: document.getElementById('modal-icon-play'),
    modalIconPause: document.getElementById('modal-icon-pause'),
    btnModalPrev: document.getElementById('btn-modal-prev'),
    btnModalNext: document.getElementById('btn-modal-next'),
    btnModalSkipBack: document.getElementById('btn-modal-skip-back'),
    btnModalSkipForward: document.getElementById('btn-modal-skip-forward'),
    modalBadgeSkipBack: document.getElementById('modal-badge-skip-back'),
    modalBadgeSkipForward: document.getElementById('modal-badge-skip-forward'),
    nowplayingDesc: document.getElementById('nowplaying-desc'),

    // Fullscreen Video Player Elements
    videoFsTopBar: document.getElementById('video-fs-top-bar'),
    videoFsTitle: document.getElementById('video-fs-title'),
    videoFsPodcast: document.getElementById('video-fs-podcast'),
    videoFsPlayerBar: document.getElementById('video-fs-player-bar'),
    videoFsTimeCurrent: document.getElementById('video-fs-time-current'),
    videoFsTimeTotal: document.getElementById('video-fs-time-total'),
    videoFsScrubber: document.getElementById('video-fs-scrubber'),
    btnVideoFsPrev: document.getElementById('btn-video-fs-prev'),
    btnVideoFsSkipBack: document.getElementById('btn-video-fs-skip-back'),
    videoFsBadgeSkipBack: document.getElementById('video-fs-badge-skip-back'),
    btnVideoFsPlayPause: document.getElementById('btn-video-fs-play-pause'),
    videoFsIconPlay: document.getElementById('video-fs-icon-play'),
    videoFsIconPause: document.getElementById('video-fs-icon-pause'),
    btnVideoFsSkipForward: document.getElementById('btn-video-fs-skip-forward'),
    videoFsBadgeSkipForward: document.getElementById('video-fs-badge-skip-forward'),
    btnVideoFsNext: document.getElementById('btn-video-fs-next'),
    videoFsSpeedSelect: document.getElementById('video-fs-speed-select'),
    btnVideoFsVolumeToggle: document.getElementById('btn-video-fs-volume-toggle'),
    videoFsIconVolHigh: document.getElementById('video-fs-icon-vol-high'),
    videoFsIconVolMute: document.getElementById('video-fs-icon-vol-mute'),
    videoFsVolumeSlider: document.getElementById('video-fs-volume-slider'),
    btnVideoFsExit: document.getElementById('btn-video-fs-exit'),

    // Add Feed Modal
    modalAddPodcast: document.getElementById('modal-add-podcast'),
    btnCloseAdd: document.getElementById('btn-close-add'),
    formAddFeed: document.getElementById('form-add-feed'),
    inputFeedUrl: document.getElementById('input-feed-url'),
    btnSubmitFeed: document.getElementById('btn-submit-feed'),
    inputSearchPodcast: document.getElementById('input-search-podcast'),
    btnSearchPodcast: document.getElementById('btn-search-podcast'),
    searchResults: document.getElementById('search-results'),

    // Episode Details Modal
    modalEpisodeDetails: document.getElementById('modal-episode-details'),
    btnCloseEpisodeDetails: document.getElementById('btn-close-episode-details'),
    episodeDetailArt: document.getElementById('episode-detail-art'),
    episodeDetailNumberBadge: document.getElementById('episode-detail-number-badge'),
    episodeDetailPodcast: document.getElementById('episode-detail-podcast'),
    episodeDetailTitle: document.getElementById('episode-detail-title'),
    episodeDetailDate: document.getElementById('episode-detail-date'),
    episodeDetailDuration: document.getElementById('episode-detail-duration'),
    episodeDetailStatusBadge: document.getElementById('episode-detail-status-badge'),
    btnEpisodeDetailPlay: document.getElementById('btn-episode-detail-play'),
    episodeDetailPlayIcon: document.getElementById('episode-detail-play-icon'),
    btnEpisodeDetailPlayText: document.getElementById('btn-episode-detail-play-text'),
    episodeDetailNotes: document.getElementById('episode-detail-notes'),

    // Settings
    formPlaybackSettings: document.getElementById('form-playback-settings'),
    settingSkipBack: document.getElementById('setting-skip-back'),
    settingSkipForward: document.getElementById('setting-skip-forward'),
    settingTheme: document.getElementById('setting-theme'),
    boxNextcloudUrl: document.getElementById('box-nextcloud-url'),
    boxGpodderUrl: document.getElementById('box-gpodder-url'),
    devicesContainer: document.getElementById('devices-container'),
    formChangePassword: document.getElementById('form-change-password'),
    inputOldPass: document.getElementById('input-old-pass'),
    inputNewPass: document.getElementById('input-new-pass'),
    inputImportOpml: document.getElementById('input-import-opml'),
    labelImportOpml: document.getElementById('label-import-opml'),
    importOpmlStatus: document.getElementById('import-opml-status'),
    inputModalImportOpml: document.getElementById('input-modal-import-opml'),
    labelModalImportOpml: document.getElementById('label-modal-import-opml'),

    // Login Modal
    modalLogin: document.getElementById('modal-login'),
    formLogin: document.getElementById('form-login'),
    loginUsername: document.getElementById('login-username'),
    loginPassword: document.getElementById('login-password'),
    loginError: document.getElementById('login-error'),

    // Toast Container
    toastContainer: document.getElementById('toast-container')
  };

  // Helper: Toast Notifications
  function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    if (isError) {
      toast.style.borderLeftColor = 'var(--ctp-red)';
    }
    toast.textContent = message;
    el.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // Format seconds to mm:ss or hh:mm:ss
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const s = Math.floor(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const secStr = secs < 10 ? '0' + secs : secs;
    if (hrs > 0) {
      const minStr = mins < 10 ? '0' + mins : mins;
      return `${hrs}:${minStr}:${secStr}`;
    }
    return `${mins}:${secStr}`;
  }

  function formatDate(epochSeconds) {
    if (!epochSeconds) return '';
    const d = new Date(epochSeconds * 1000);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Active media element (either nativeAudio or nowplayingVideo)
  function getActiveMediaElement() {
    return state.isVideo ? el.nowplayingVideo : el.nativeAudio;
  }

  // Theme Handling
  function applyTheme(theme) {
    state.config.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('antennapodder_theme', theme);
    if (theme === 'latte') {
      el.themeIconMoon.style.display = 'none';
      el.themeIconSun.style.display = 'block';
      el.settingTheme.value = 'latte';
    } else {
      el.themeIconMoon.style.display = 'block';
      el.themeIconSun.style.display = 'none';
      el.settingTheme.value = 'mocha';
    }
  }

  function toggleTheme() {
    const next = state.config.theme === 'mocha' ? 'latte' : 'mocha';
    applyTheme(next);
    // Save to server
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: next })
    }).catch(() => {});
  }

  // View Navigation with Hash Routing
  function switchView(viewName, updateHash = true) {
    if (updateHash) {
      let targetHash = '#/library';
      if (viewName === 'settings') targetHash = '#/settings';
      else if (viewName === 'podcast' && state.currentPodcast) targetHash = `#/podcast/${state.currentPodcast.id}`;

      if (window.location.hash === targetHash) {
        handleHashRoute();
      } else {
        window.location.hash = targetHash;
      }
      return;
    }

    el.viewLibrary.classList.remove('active');
    el.viewPodcast.classList.remove('active');
    el.viewSettings.classList.remove('active');

    if (viewName !== 'podcast' && state.multiSelectMode) {
      setMultiSelectMode(false);
    }

    if (viewName === 'library') {
      el.viewLibrary.classList.add('active');
      loadLibrary();
    } else if (viewName === 'podcast') {
      el.viewPodcast.classList.add('active');
    } else if (viewName === 'settings') {
      el.viewSettings.classList.add('active');
      loadSettings();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleHashRoute() {
    const hash = window.location.hash || '#/library';
    const podMatch = hash.match(/^#\/podcast\/(\d+)$/);
    if (podMatch) {
      const podcastId = parseInt(podMatch[1], 10);
      openPodcastDetail(podcastId, false);
      return;
    }
    if (hash === '#/settings') {
      switchView('settings', false);
      return;
    }
    switchView('library', false);
  }

  window.addEventListener('hashchange', handleHashRoute);

  // API Calls
  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.user) {
        state.user = data.user;
        if (data.config) {
          state.config.skip_forward_sec = parseInt(data.config.skip_forward_sec, 10) || 30;
          state.config.skip_back_sec = parseInt(data.config.skip_back_sec, 10) || 10;
          if (data.config.theme) {
            applyTheme(data.config.theme);
          }
        }
        updateSkipBadges();
        el.modalLogin.classList.remove('active');
        return true;
      } else {
        el.modalLogin.classList.add('active');
        return false;
      }
    } catch (e) {
      console.error('checkAuth failed:', e);
      el.modalLogin.classList.add('active');
      return false;
    }
  }

  function updateSkipBadges() {
    el.badgeSkipBack.textContent = state.config.skip_back_sec;
    el.badgeSkipForward.textContent = state.config.skip_forward_sec;
    el.modalBadgeSkipBack.textContent = state.config.skip_back_sec;
    el.modalBadgeSkipForward.textContent = state.config.skip_forward_sec;
    if (el.videoFsBadgeSkipBack) el.videoFsBadgeSkipBack.textContent = state.config.skip_back_sec;
    if (el.videoFsBadgeSkipForward) el.videoFsBadgeSkipForward.textContent = state.config.skip_forward_sec;
    el.settingSkipBack.value = state.config.skip_back_sec;
    el.settingSkipForward.value = state.config.skip_forward_sec;
  }

  // Library Loader
  async function loadLibrary() {
    try {
      const [res, inProgRes] = await Promise.all([
        fetch('/api/library'),
        fetch('/api/episodes/in-progress').catch(() => null)
      ]);
      if (res.status === 401) {
        el.modalLogin.classList.add('active');
        return;
      }
      const data = await res.json();
      state.subscriptions = data.subscriptions || [];
      renderLibrary();

      if (inProgRes && inProgRes.ok) {
        const inProgData = await inProgRes.json();
        renderContinueListening(inProgData.episodes || []);
      } else if (el.continueSection) {
        el.continueSection.style.display = 'none';
      }
    } catch (e) {
      showToast('Failed to load library: ' + e.message, true);
    }
  }

  async function loadInProgressEpisodes() {
    if (!el.continueSection || !el.continueGrid) return;
    try {
      const res = await fetch('/api/episodes/in-progress');
      if (res.ok) {
        const data = await res.json();
        renderContinueListening(data.episodes || []);
      } else {
        el.continueSection.style.display = 'none';
        el.continueGrid.innerHTML = '';
      }
    } catch (e) {
      // Ignore network errors
    }
  }

  function renderContinueListening(episodes) {
    if (!el.continueSection || !el.continueGrid) return;
    if (!episodes || episodes.length === 0) {
      el.continueSection.style.display = 'none';
      el.continueGrid.innerHTML = '';
      return;
    }

    el.continueSection.style.display = 'block';
    el.continueGrid.innerHTML = '';

    episodes.forEach(ep => {
      const card = document.createElement('div');
      card.className = 'continue-card';
      card.dataset.episodeId = String(ep.id);

      const progressPercent = ep.total_duration > 0
        ? Math.min(100, Math.round((ep.position / ep.total_duration) * 100))
        : 0;

      const remainingSec = Math.max(0, (ep.total_duration || 0) - ep.position);
      const remainingText = remainingSec > 0 ? `${formatTime(remainingSec)} left` : `${formatTime(ep.position)} listened`;
      const artUrl = ep.image_url || ep.podcast_image_url || '/icons/icon-192.png';

      card.innerHTML = `
        <div class="continue-card-art-wrap">
          <img class="continue-card-art" src="${escapeHtml(artUrl)}" alt="" loading="lazy" onerror="this.src='/icons/icon-192.png'">
          <div class="continue-card-play-overlay">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          </div>
        </div>
        <div class="continue-card-body">
          <div class="continue-card-podcast">${escapeHtml(ep.podcast_title || 'Podcast')}</div>
          <div class="continue-card-title">${escapeHtml(ep.title)}</div>
          <div class="continue-progress-bar">
            <div class="continue-progress-fill" style="width: ${progressPercent}%;"></div>
          </div>
          <div class="continue-card-time">
            <span>${formatTime(ep.position)}</span>
            <span>${remainingText}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        const podcastObj = {
          id: ep.podcast_id,
          title: ep.podcast_title,
          url: ep.podcast_url,
          image_url: ep.podcast_image_url
        };
        playEpisode(ep, podcastObj);
      });

      el.continueGrid.appendChild(card);
    });
  }

  function renderLibrary() {
    if (el.podcastSortSelect && el.podcastSortSelect.value !== state.podcastSort) {
      el.podcastSortSelect.value = state.podcastSort;
    }
    if (el.podcastSearchInput && el.podcastSearchInput.value !== state.librarySearchQuery) {
      el.podcastSearchInput.value = state.librarySearchQuery;
    }

    let list = [...state.subscriptions];

    // Filter by search query (title, author, description)
    if (state.librarySearchQuery) {
      const q = state.librarySearchQuery.toLowerCase();
      list = list.filter(p => {
        const title = (p.title || '').toLowerCase();
        const author = (p.author || '').toLowerCase();
        const desc = (p.description || '').toLowerCase();
        return title.includes(q) || author.includes(q) || desc.includes(q);
      });

      if (el.continueSection) {
        el.continueSection.style.display = 'none';
      }
    } else {
      if (el.continueSection && el.continueGrid && el.continueGrid.children.length > 0) {
        el.continueSection.style.display = 'block';
      }
    }

    // Filter favorites
    if (state.podcastFilter === 'favs') {
      list = list.filter(p => p.is_favorite);
    }

    // Sort list
    if (state.podcastSort === 'alpha') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base', numeric: true }));
    } else if (state.podcastSort === 'episodes') {
      list.sort((a, b) => {
        const diff = (Number(b.total_episodes) || 0) - (Number(a.total_episodes) || 0);
        return diff !== 0 ? diff : (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base', numeric: true });
      });
    } else {
      // Default: most recently updated
      list.sort((a, b) => {
        const dateA = Number(a.latest_pub_date || a.last_fetched_at || 0);
        const dateB = Number(b.latest_pub_date || b.last_fetched_at || 0);
        const diff = dateB - dateA;
        return diff !== 0 ? diff : (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base', numeric: true });
      });
    }

    el.libraryGrid.innerHTML = '';
    if (list.length === 0) {
      el.libraryEmpty.style.display = 'block';
      el.libraryGrid.style.display = 'none';

      if (state.subscriptions.length === 0) {
        if (el.libraryEmptyTitle) el.libraryEmptyTitle.textContent = 'No podcast subscriptions yet';
        if (el.libraryEmptyDesc) el.libraryEmptyDesc.textContent = 'Add a podcast feed URL or sync with AntennaPod to start listening.';
        if (el.btnEmptyAdd) el.btnEmptyAdd.style.display = 'inline-block';
        if (el.btnEmptyClearSearch) el.btnEmptyClearSearch.style.display = 'none';
      } else if (state.librarySearchQuery) {
        if (el.libraryEmptyTitle) el.libraryEmptyTitle.textContent = `No podcasts found matching "${state.librarySearchQuery}"`;
        if (el.libraryEmptyDesc) el.libraryEmptyDesc.textContent = 'Check for typos or try searching by author or keyword.';
        if (el.btnEmptyAdd) el.btnEmptyAdd.style.display = 'none';
        if (el.btnEmptyClearSearch) el.btnEmptyClearSearch.style.display = 'inline-block';
      } else if (state.podcastFilter === 'favs') {
        if (el.libraryEmptyTitle) el.libraryEmptyTitle.textContent = 'No favorite podcasts yet';
        if (el.libraryEmptyDesc) el.libraryEmptyDesc.textContent = 'Click the star icon on any podcast card to mark it as a favorite.';
        if (el.btnEmptyAdd) el.btnEmptyAdd.style.display = 'none';
        if (el.btnEmptyClearSearch) el.btnEmptyClearSearch.style.display = 'none';
      }
      return;
    }

    el.libraryEmpty.style.display = 'none';
    el.libraryGrid.style.display = 'grid';

    const fragment = document.createDocumentFragment();
    list.forEach(pod => {
      const card = document.createElement('div');
      card.className = 'podcast-card';
      const epCountText = pod.total_episodes != null ? `${pod.total_episodes} ${pod.total_episodes === 1 ? 'ep' : 'eps'}` : '';
      const dateText = pod.latest_pub_date ? formatDate(pod.latest_pub_date) : '';
      const metaParts = [epCountText, dateText].filter(Boolean).join(' &bull; ');

      card.innerHTML = `
        <button class="podcast-card-fav ${pod.is_favorite ? 'active' : ''}" title="${pod.is_favorite ? 'Remove from favorites' : 'Add to favorites'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${pod.is_favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
        <img class="podcast-card-img" src="${pod.image_url || '/favicon.ico'}" alt="${pod.title}" loading="lazy" decoding="async" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\'><rect fill=\\'%23313244\\' width=\\'100\\' height=\\'100\\'/><text fill=\\'%23bac2de\\' x=\\'50\\' y=\\'55\\' font-size=\\'12\\' text-anchor=\\'middle\\'>Podcast</text></svg>'">
        ${pod.unplayed_episodes > 0 ? `<div class="podcast-card-badge">${pod.unplayed_episodes} new</div>` : ''}
        <div class="podcast-card-info">
          <div class="podcast-card-title">${escapeHtml(pod.title)}</div>
          <div class="podcast-card-author">${escapeHtml(pod.author || '')}</div>
          ${metaParts ? `<div class="podcast-card-meta" style="font-size: 0.75rem; color: var(--theme-muted); margin-top: 0.25rem;">${metaParts}</div>` : ''}
        </div>
      `;

      const favBtn = card.querySelector('.podcast-card-fav');
      favBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await togglePodcastFavoriteApi(pod.id);
      });

      card.addEventListener('click', () => openPodcastDetail(pod.id));
      fragment.appendChild(card);
    });
    el.libraryGrid.appendChild(fragment);
  }

  async function togglePodcastFavoriteApi(podcastId) {
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/favorite`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const pod = state.subscriptions.find(p => p.id === podcastId);
        if (pod) pod.is_favorite = data.is_favorite ? 1 : 0;
        if (state.currentPodcast && state.currentPodcast.id === podcastId) {
          state.currentPodcast.is_favorite = Boolean(data.is_favorite);
          updatePodcastDetailFavoriteButton();
        }
        renderLibrary();
        showToast(data.is_favorite ? 'Added podcast to favorites' : 'Removed podcast from favorites');
      }
    } catch (e) {
      showToast('Failed to update favorite: ' + e.message, true);
    }
  }

  function updatePodcastDetailFavoriteButton() {
    if (!el.btnPodcastFavorite) return;
    const isFav = Boolean(state.currentPodcast?.is_favorite);
    if (isFav) {
      el.btnPodcastFavorite.classList.add('btn-podcast-fav-active');
      if (el.iconPodcastFav) el.iconPodcastFav.setAttribute('fill', 'currentColor');
      if (el.textPodcastFav) el.textPodcastFav.textContent = 'Favorited';
    } else {
      el.btnPodcastFavorite.classList.remove('btn-podcast-fav-active');
      if (el.iconPodcastFav) el.iconPodcastFav.setAttribute('fill', 'none');
      if (el.textPodcastFav) el.textPodcastFav.textContent = 'Favorite';
    }
  }

  // Podcast Detail Loader
  async function openPodcastDetail(podcastId, updateHash = true) {
    if (updateHash) {
      const targetHash = `#/podcast/${podcastId}`;
      if (window.location.hash === targetHash) {
        openPodcastDetail(podcastId, false);
      } else {
        window.location.hash = targetHash;
      }
      return;
    }
    try {
      const res = await fetch(`/api/podcasts/${podcastId}`);
      if (res.status === 401) {
        el.modalLogin.classList.add('active');
        return;
      }
      const data = await res.json();
      if (!data.podcast) return;

      state.currentPodcast = data.podcast;
      state.currentEpisodes = data.podcast.episodes || [];
      state.multiSelectMode = false;
      state.selectedEpisodeIds.clear();
      if (el.episodesBatchBar) el.episodesBatchBar.style.display = 'none';
      if (el.btnToggleMultiSelect) {
        el.btnToggleMultiSelect.classList.remove('active');
        if (el.textToggleMultiSelect) el.textToggleMultiSelect.textContent = 'Select';
      }
      if (el.episodesList) {
        el.episodesList.classList.remove('multi-select-active');
      }
      updateBatchCount();

      el.detailArt.src = data.podcast.image_url || '';
      el.detailTitle.textContent = decodeHtml(data.podcast.title);
      el.detailAuthor.textContent = decodeHtml(data.podcast.author || 'Unknown author');
      el.detailDesc.innerHTML = data.podcast.description || '';
      el.episodeSearchInput.value = '';
      state.filter = 'all';
      state.searchQuery = '';
      updateFilterButtons();
      updatePodcastDetailFavoriteButton();

      renderEpisodesList();
      switchView('podcast', false);
    } catch (e) {
      showToast('Failed to load podcast: ' + e.message, true);
    }
  }

  function updateFilterButtons() {
    el.filterBtns.forEach(btn => {
      if (btn.dataset.filter === state.filter) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function updateBatchCount() {
    if (el.batchSelectedCount) {
      el.batchSelectedCount.textContent = state.selectedEpisodeIds.size;
    }
  }

  function setMultiSelectMode(enabled) {
    state.multiSelectMode = enabled;
    if (el.episodesBatchBar) {
      el.episodesBatchBar.style.display = enabled ? 'flex' : 'none';
    }
    if (el.btnToggleMultiSelect) {
      if (enabled) {
        el.btnToggleMultiSelect.classList.add('active');
        if (el.textToggleMultiSelect) el.textToggleMultiSelect.textContent = 'Cancel';
      } else {
        el.btnToggleMultiSelect.classList.remove('active');
        if (el.textToggleMultiSelect) el.textToggleMultiSelect.textContent = 'Select';
      }
    }
    if (!enabled) {
      state.selectedEpisodeIds.clear();
    }
    if (el.episodesList) {
      el.episodesList.classList.toggle('multi-select-active', enabled);
    }
    updateBatchCount();
    renderEpisodesList();
  }

  function getFilteredEpisodes() {
    let filtered = state.currentEpisodes;

    if (state.filter === 'unplayed') {
      filtered = filtered.filter(e => !e.is_played);
    } else if (state.filter === 'progress') {
      filtered = filtered.filter(e => !e.is_played && e.position > 0);
    } else if (state.filter === 'played') {
      filtered = filtered.filter(e => e.is_played);
    } else if (state.filter === 'favorites') {
      filtered = filtered.filter(e => e.is_favorite);
    }

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      filtered = filtered.filter(e => e.title.toLowerCase().includes(q) || (e.description && e.description.toLowerCase().includes(q)));
    }

    return filtered;
  }

  function renderEpisodesList() {
    el.episodesList.innerHTML = '';

    const filtered = getFilteredEpisodes();

    if (filtered.length === 0) {
      el.episodesList.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--theme-muted);">No episodes match this filter.</div>';
      return;
    }

    filtered.forEach(ep => {
      const item = document.createElement('div');
      const isSelected = state.selectedEpisodeIds.has(ep.id);
      item.className = `episode-item ${ep.is_played ? 'played' : ''} ${isSelected ? 'selected' : ''}`;

      const isVideoEp = (ep.enclosure_type && ep.enclosure_type.startsWith('video/')) || /\.(mp4|m4v|webm|mov)$/i.test(ep.enclosure_url);
      const isCurrentActive = state.activeEpisode && state.activeEpisode.id === ep.id;
      const playIcon = isCurrentActive && state.isPlaying
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';

      let progressPercent = 0;
      if (ep.total_duration > 0 && ep.position > 0) {
        progressPercent = Math.min(100, Math.round((ep.position / ep.total_duration) * 100));
      }

      const selectCheckboxHtml = state.multiSelectMode ? `
        <div class="episode-select-wrapper">
          <input type="checkbox" class="episode-select-checkbox" data-id="${ep.id}" ${isSelected ? 'checked' : ''} aria-label="Select episode">
        </div>
      ` : '';

      item.innerHTML = `
        ${selectCheckboxHtml}
        <button class="episode-play-btn" title="${isCurrentActive && state.isPlaying ? 'Pause' : 'Play'}">
          ${playIcon}
        </button>
        <div class="episode-content">
          <div class="episode-meta">
            <span>${formatDate(ep.pub_date)}</span>
            <span>&bull;</span>
            <span>${formatTime(ep.duration || ep.total_duration)}</span>
            ${isVideoEp ? '<span class="episode-type-badge">Video</span>' : ''}
            ${ep.is_favorite ? '<span style="color: var(--ctp-yellow); font-weight: 600;">★ Favorite</span> &bull;' : ''}
            ${ep.is_played ? '<span style="color: var(--ctp-green); font-weight: 600;">✓ Played</span>' : ''}
          </div>
          <div class="episode-title">${escapeHtml(ep.title)}</div>
          <div class="episode-desc-snippet">${cleanSnippet(ep.description)}</div>
          ${!ep.is_played && progressPercent > 0 ? `
            <div class="episode-progress-bar">
              <div class="episode-progress-fill" style="width: ${progressPercent}%;"></div>
            </div>
          ` : ''}
        </div>
        <div class="episode-actions">
          <button class="btn-icon btn-episode-info" title="Episode Info" aria-label="Episode Info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          </button>
          <button class="btn-icon btn-toggle-favorite ${ep.is_favorite ? 'active' : ''}" title="${ep.is_favorite ? 'Remove Favorite' : 'Favorite Episode'}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="${ep.is_favorite ? 'var(--ctp-yellow)' : 'none'}" stroke="${ep.is_favorite ? 'var(--ctp-yellow)' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          </button>
          <button class="btn-icon btn-toggle-played" title="${ep.is_played ? 'Mark Unplayed' : 'Mark Played'}">
            ${ep.is_played 
              ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>'
              : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
            }
          </button>
        </div>
      `;

      if (state.multiSelectMode) {
        const checkbox = item.querySelector('.episode-select-checkbox');
        if (checkbox) {
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              state.selectedEpisodeIds.add(ep.id);
              item.classList.add('selected');
            } else {
              state.selectedEpisodeIds.delete(ep.id);
              item.classList.remove('selected');
            }
            updateBatchCount();
          });
        }

        item.addEventListener('click', (e) => {
          if (e.target.closest('button') || e.target.closest('input')) return;
          if (state.selectedEpisodeIds.has(ep.id)) {
            state.selectedEpisodeIds.delete(ep.id);
            if (checkbox) checkbox.checked = false;
            item.classList.remove('selected');
          } else {
            state.selectedEpisodeIds.add(ep.id);
            if (checkbox) checkbox.checked = true;
            item.classList.add('selected');
          }
          updateBatchCount();
        });
      }

      // Play button click
      const playBtn = item.querySelector('.episode-play-btn');
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isCurrentActive) {
          togglePlayPause();
        } else {
          playEpisode(ep, state.currentPodcast);
        }
      });

      // Episode info button click
      const infoBtn = item.querySelector('.btn-episode-info');
      if (infoBtn) {
        infoBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showEpisodeDetailsModal(ep, state.currentPodcast, state.currentEpisodes);
        });
      }

      // Toggle favorite click
      const favBtn = item.querySelector('.btn-toggle-favorite');
      favBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await toggleEpisodeFavoriteApi(ep.id);
      });

      // Toggle played click
      const toggleBtn = item.querySelector('.btn-toggle-played');
      toggleBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await togglePlayedStatus(ep.id);
      });

      el.episodesList.appendChild(item);
    });
  }

  // Toggle favorite episode API
  async function toggleEpisodeFavoriteApi(episodeId) {
    try {
      const res = await fetch(`/api/episodes/${episodeId}/toggle-favorite`, { method: 'POST' });
      const data = await res.json();
      if (data.success && state.currentPodcast) {
        const ep = state.currentEpisodes.find(e => e.id === episodeId);
        if (ep) {
          ep.is_favorite = data.state.is_favorite;
        }
        renderEpisodesList();
        showToast(data.state.is_favorite ? 'Episode marked favorite (synced)' : 'Episode removed from favorites (synced)');
      }
    } catch (e) {
      showToast('Error: ' + e.message, true);
    }
  }

  // Toggle played status API
  async function togglePlayedStatus(episodeId) {
    try {
      const res = await fetch(`/api/episodes/${episodeId}/toggle-played`, { method: 'POST' });
      const data = await res.json();
      if (data.success && state.currentPodcast) {
        // Refresh local state
        const ep = state.currentEpisodes.find(e => e.id === episodeId);
        if (ep) {
          ep.is_played = data.state.is_played;
          ep.position = data.state.position;
        }
        renderEpisodesList();
        loadInProgressEpisodes();
        showToast(data.state.is_played ? 'Marked as played (synced)' : 'Marked as unplayed (synced)');
      }
    } catch (e) {
      showToast('Error: ' + e.message, true);
    }
  }

  // Episode Details Modal logic
  function formatEpisodeNumber(ep, allEpisodes) {
    if (ep.episode_number) {
      if (ep.season) {
        return `Season ${ep.season}, Episode ${ep.episode_number}`;
      }
      return `Episode ${ep.episode_number}`;
    }

    // Try extracting from title: e.g. "Episode 42", "Ep 42", "Ep. 42", "#42"
    if (ep.title) {
      const match = ep.title.match(/(?:(?:Season\s*(\d+)\s*[,:]?\s*)?(?:Episode|Ep\.?|#)\s*(\d+))/i);
      if (match) {
        const season = match[1];
        const num = match[2];
        return season ? `Season ${season}, Episode ${num}` : `Episode ${num}`;
      }
    }

    // Fallback: chronological episode position in podcast
    if (Array.isArray(allEpisodes) && allEpisodes.length > 0) {
      const sorted = [...allEpisodes].sort((a, b) => (a.pub_date || 0) - (b.pub_date || 0));
      const idx = sorted.findIndex(e => e.id === ep.id);
      if (idx !== -1) {
        return `Episode ${idx + 1}`;
      }
    }

    return 'Episode Info';
  }

  function formatShowNotes(rawHtml) {
    if (!rawHtml || !rawHtml.trim()) {
      return '<em style="color: var(--theme-muted);">No show notes provided for this episode.</em>';
    }

    const hasHtmlTags = /<[a-z][\s\S]*>/i.test(rawHtml);
    let container = document.createElement('div');
    if (hasHtmlTags) {
      container.innerHTML = rawHtml;
    } else {
      const escaped = escapeHtml(rawHtml);
      const withLinks = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
      container.innerHTML = withLinks.replace(/\n\n+/g, '<br><br>').replace(/\n/g, '<br>');
    }

    container.querySelectorAll('a').forEach(a => {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    });

    return container.innerHTML;
  }

  function showEpisodeDetailsModal(ep, podcast, allEpisodes) {
    if (!ep) return;
    state.selectedDetailEpisode = ep;

    if (el.episodeDetailArt) {
      el.episodeDetailArt.src = ep.image_url || podcast?.image_url || '';
    }

    if (el.episodeDetailNumberBadge) {
      el.episodeDetailNumberBadge.textContent = formatEpisodeNumber(ep, allEpisodes);
    }

    if (el.episodeDetailPodcast) {
      el.episodeDetailPodcast.textContent = podcast?.title ? decodeHtml(podcast.title) : '';
    }

    if (el.episodeDetailTitle) {
      el.episodeDetailTitle.textContent = decodeHtml(ep.title || 'Untitled Episode');
    }

    if (el.episodeDetailDate) {
      el.episodeDetailDate.textContent = formatDate(ep.pub_date);
    }

    if (el.episodeDetailDuration) {
      el.episodeDetailDuration.textContent = formatTime(ep.duration || ep.total_duration);
    }

    if (el.episodeDetailStatusBadge) {
      if (ep.is_played) {
        el.episodeDetailStatusBadge.innerHTML = '<span style="color: var(--ctp-green); font-weight: 600;">✓ Played</span>';
      } else if (ep.position > 0 && ep.total_duration > 0) {
        const pct = Math.min(100, Math.round((ep.position / ep.total_duration) * 100));
        el.episodeDetailStatusBadge.innerHTML = `<span style="color: var(--theme-accent); font-weight: 600;">${pct}% played</span>`;
      } else {
        el.episodeDetailStatusBadge.innerHTML = '<span style="color: var(--theme-muted);">Unplayed</span>';
      }
    }

    updateEpisodeDetailPlayBtn(ep);

    if (el.episodeDetailNotes) {
      el.episodeDetailNotes.innerHTML = formatShowNotes(ep.description);
      el.episodeDetailNotes.scrollTop = 0;
    }

    if (el.modalEpisodeDetails) {
      el.modalEpisodeDetails.classList.add('active');
    }
  }

  function updateEpisodeDetailPlayBtn(ep) {
    if (!el.btnEpisodeDetailPlay || !ep) return;
    const isCurrentActive = state.activeEpisode && state.activeEpisode.id === ep.id;
    if (isCurrentActive && state.isPlaying) {
      if (el.btnEpisodeDetailPlayText) el.btnEpisodeDetailPlayText.textContent = 'Pause Episode';
      if (el.episodeDetailPlayIcon) {
        el.episodeDetailPlayIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
      }
    } else {
      if (el.btnEpisodeDetailPlayText) el.btnEpisodeDetailPlayText.textContent = isCurrentActive ? 'Resume Episode' : 'Play Episode';
      if (el.episodeDetailPlayIcon) {
        el.episodeDetailPlayIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
      }
    }
  }

  // Play Episode
  function playEpisode(episode, podcast) {
    state.activeEpisode = episode;
    state.activePodcast = podcast;

    const isVideo = (episode.enclosure_type && episode.enclosure_type.startsWith('video/')) || /\.(mp4|m4v|webm|mov)$/i.test(episode.enclosure_url);
    state.isVideo = isVideo;

    // Show player bar
    el.playerBar.style.display = 'flex';

    // Update player bar info
    el.playerThumb.src = episode.image_url || podcast.image_url || '';
    el.playerTitle.textContent = decodeHtml(episode.title);
    el.playerPodcast.textContent = decodeHtml(podcast.title);

    // Update modal info
    el.nowplayingArt.src = episode.image_url || podcast.image_url || '';
    el.nowplayingTitle.textContent = decodeHtml(episode.title);
    el.nowplayingPodcast.textContent = decodeHtml(podcast.title);
    el.nowplayingDesc.innerHTML = episode.description || 'No show notes available.';

    // Update fullscreen video info
    if (el.videoFsTitle) el.videoFsTitle.textContent = decodeHtml(episode.title);
    if (el.videoFsPodcast) el.videoFsPodcast.textContent = decodeHtml(podcast.title);
    syncSpeedSelect(el.videoFsSpeedSelect, state.playbackRate);
    syncSpeedSelect(el.playerSpeed, state.playbackRate);

    if (isVideo) {
      if (el.btnPlayerFullscreenVideo) el.btnPlayerFullscreenVideo.style.display = 'inline-flex';
      el.nowplayingVideoWrapper.classList.add('active');
      el.nowplayingArt.style.display = 'none';
      el.nativeAudio.pause();
      el.nowplayingVideo.src = episode.enclosure_url;
      el.nowplayingVideo.playbackRate = state.playbackRate;
      el.nowplayingVideo.volume = state.volume;
      el.nowplayingVideo.muted = state.isMuted;
      if (episode.position > 0 && episode.position < (episode.duration || 999999) - 10) {
        el.nowplayingVideo.currentTime = episode.position;
      }
      el.nowplayingVideo.play().catch(console.error);
    } else {
      if (el.btnPlayerFullscreenVideo) el.btnPlayerFullscreenVideo.style.display = 'none';
      el.nowplayingVideoWrapper.classList.remove('active');
      el.nowplayingArt.style.display = 'block';
      el.nowplayingVideo.pause();
      el.nowplayingVideo.removeAttribute('src');
      el.nativeAudio.src = episode.enclosure_url;
      el.nativeAudio.playbackRate = state.playbackRate;
      el.nativeAudio.volume = state.volume;
      el.nativeAudio.muted = state.isMuted;
      if (episode.position > 0 && episode.position < (episode.duration || 999999) - 10) {
        el.nativeAudio.currentTime = episode.position;
      }
      el.nativeAudio.play().catch(console.error);
    }

    state.isPlaying = true;
    updatePlayPauseIcons(true);
    updateMediaSession(episode, podcast);
    startSyncHeartbeat();

    if (state.currentPodcast && state.currentPodcast.id === podcast.id) {
      renderEpisodesList();
    }
  }

  let openedModalForFullscreen = false;
  let fsControlsTimeout = null;

  function resetFsControlsTimer() {
    clearTimeout(fsControlsTimeout);
    if (!el.nowplayingVideoWrapper) return;
    el.nowplayingVideoWrapper.classList.remove('controls-hidden');
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (isFs && state.isPlaying) {
      fsControlsTimeout = setTimeout(() => {
        const isStillFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
        if (isStillFs && state.isPlaying) {
          el.nowplayingVideoWrapper.classList.add('controls-hidden');
        }
      }, 3000);
    }
  }

  async function toggleVideoFullscreen() {
    const video = el.nowplayingVideo;
    const wrapper = el.nowplayingVideoWrapper;
    if (!video || !wrapper) return;

    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        await document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      return;
    }

    const wasModalOpen = el.modalNowPlaying.classList.contains('active');
    openedModalForFullscreen = !wasModalOpen;

    // Ensure Now Playing modal and video wrapper are active in DOM so the video is visible and rendered
    el.modalNowPlaying.classList.add('active');
    wrapper.classList.add('active');

    try {
      if (wrapper.requestFullscreen) {
        await wrapper.requestFullscreen();
      } else if (wrapper.webkitRequestFullscreen) {
        wrapper.webkitRequestFullscreen();
      } else if (video.requestFullscreen) {
        await video.requestFullscreen();
      } else if (video.webkitRequestFullscreen) {
        video.webkitRequestFullscreen();
      } else if (video.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
      }
    } catch (err) {
      console.warn('Wrapper fullscreen request failed:', err);
      if (video.requestFullscreen) {
        await video.requestFullscreen().catch(() => {});
      }
    }
  }

  function handleFullscreenChange() {
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (isFs) {
      if (el.nowplayingVideoWrapper) {
        el.nowplayingVideoWrapper.classList.add('is-fullscreen');
      }
      resetFsControlsTimer();
    } else {
      clearTimeout(fsControlsTimeout);
      if (el.nowplayingVideoWrapper) {
        el.nowplayingVideoWrapper.classList.remove('is-fullscreen');
        el.nowplayingVideoWrapper.classList.remove('controls-hidden');
      }
      if (openedModalForFullscreen) {
        openedModalForFullscreen = false;
        el.modalNowPlaying.classList.remove('active');
      }
    }
  }

  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

  function togglePlayPause() {
    const media = getActiveMediaElement();
    if (!media.src) return;

    if (media.paused) {
      media.play().catch(console.error);
      state.isPlaying = true;
      updatePlayPauseIcons(true);
      startSyncHeartbeat();
    } else {
      media.pause();
      state.isPlaying = false;
      updatePlayPauseIcons(false);
      stopSyncHeartbeat();
      syncCurrentPlaybackState('pause');
    }

    if (state.currentPodcast) {
      renderEpisodesList();
    }
  }

  function updatePlayPauseIcons(playing) {
    if (playing) {
      el.iconPlay.style.display = 'none';
      el.iconPause.style.display = 'block';
      el.modalIconPlay.style.display = 'none';
      el.modalIconPause.style.display = 'block';
      if (el.videoFsIconPlay) el.videoFsIconPlay.style.display = 'none';
      if (el.videoFsIconPause) el.videoFsIconPause.style.display = 'block';
    } else {
      el.iconPlay.style.display = 'block';
      el.iconPause.style.display = 'none';
      el.modalIconPlay.style.display = 'block';
      el.modalIconPause.style.display = 'none';
      if (el.videoFsIconPlay) el.videoFsIconPlay.style.display = 'block';
      if (el.videoFsIconPause) el.videoFsIconPause.style.display = 'none';
    }
    if (state.selectedDetailEpisode) {
      updateEpisodeDetailPlayBtn(state.selectedDetailEpisode);
    }
  }

  // Seek skip forward and backward
  function skipBackward() {
    const media = getActiveMediaElement();
    if (!media.src) return;
    const skipSec = state.config.skip_back_sec || 10;
    media.currentTime = Math.max(0, media.currentTime - skipSec);
    syncCurrentPlaybackState('play');
  }

  function skipForward() {
    const media = getActiveMediaElement();
    if (!media.src) return;
    const skipSec = state.config.skip_forward_sec || 30;
    media.currentTime = Math.min(media.duration || 999999, media.currentTime + skipSec);
    syncCurrentPlaybackState('play');
  }

  // Next and Previous tracks
  function playPreviousTrack() {
    if (!state.currentEpisodes || state.currentEpisodes.length === 0) return;
    const idx = state.currentEpisodes.findIndex(e => e.id === state.activeEpisode?.id);
    if (idx > 0) {
      playEpisode(state.currentEpisodes[idx - 1], state.currentPodcast);
    }
  }

  function playNextTrack() {
    if (!state.currentEpisodes || state.currentEpisodes.length === 0) return;
    const idx = state.currentEpisodes.findIndex(e => e.id === state.activeEpisode?.id);
    if (idx >= 0 && idx < state.currentEpisodes.length - 1) {
      playEpisode(state.currentEpisodes[idx + 1], state.currentPodcast);
    }
  }

  // Heartbeat progress sync with backend
  function startSyncHeartbeat() {
    stopSyncHeartbeat();
    state.syncInterval = setInterval(() => {
      if (state.isPlaying) {
        syncCurrentPlaybackState('play');
      }
    }, 8000);
  }

  function stopSyncHeartbeat() {
    if (state.syncInterval) {
      clearInterval(state.syncInterval);
      state.syncInterval = null;
    }
  }

  async function syncCurrentPlaybackState(action = 'play') {
    if (!state.activeEpisode) return;
    const media = getActiveMediaElement();
    const position = Math.floor(media.currentTime || 0);
    const total = Math.floor(media.duration || state.activeEpisode.duration || 0);
    const isPlayed = (total > 0 && position >= total * 0.95) ? 1 : 0;

    try {
      await fetch(`/api/episodes/${state.activeEpisode.id}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position, total, is_played: isPlayed, action })
      });
    } catch (e) {
      // silent fail in background
    }
  }

  function dismissPlayer() {
    stopSyncHeartbeat();
    state.isPlaying = false;
    updatePlayPauseIcons(false);

    // Exit fullscreen if active
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }

    // Stop and clear media elements
    el.nativeAudio.pause();
    el.nativeAudio.removeAttribute('src');
    el.nativeAudio.load();

    el.nowplayingVideo.pause();
    el.nowplayingVideo.removeAttribute('src');
    el.nowplayingVideo.load();

    // Hide player bar and now playing modal
    el.playerBar.style.display = 'none';
    el.modalNowPlaying.classList.remove('active');
    el.nowplayingVideoWrapper.classList.remove('active');

    // Reset scrubber and time text
    el.playerScrubber.value = 0;
    el.nowplayingScrubber.value = 0;
    if (el.videoFsScrubber) el.videoFsScrubber.value = 0;
    el.playerTimeCurrent.textContent = '0:00';
    el.playerTimeTotal.textContent = '0:00';
    el.nowplayingTimeCurrent.textContent = '0:00';
    el.nowplayingTimeTotal.textContent = '0:00';
    if (el.videoFsTimeCurrent) el.videoFsTimeCurrent.textContent = '0:00';
    if (el.videoFsTimeTotal) el.videoFsTimeTotal.textContent = '0:00';

    state.activeEpisode = null;
    state.activePodcast = null;
    state.isVideo = false;

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
    }
  }

  // Setup media element event listeners
  function setupMediaEventListeners(media) {
    media.addEventListener('timeupdate', () => {
      const cur = media.currentTime || 0;
      const dur = media.duration || 0;

      el.playerTimeCurrent.textContent = formatTime(cur);
      el.nowplayingTimeCurrent.textContent = formatTime(cur);
      if (el.videoFsTimeCurrent) el.videoFsTimeCurrent.textContent = formatTime(cur);

      if (dur > 0) {
        el.playerTimeTotal.textContent = formatTime(dur);
        el.nowplayingTimeTotal.textContent = formatTime(dur);
        if (el.videoFsTimeTotal) el.videoFsTimeTotal.textContent = formatTime(dur);
        const progress = (cur / dur) * 100;
        el.playerScrubber.value = progress;
        el.nowplayingScrubber.value = progress;
        if (el.videoFsScrubber) el.videoFsScrubber.value = progress;
      }
    });

    media.addEventListener('ended', async () => {
      const finishedEp = state.activeEpisode;
      if (finishedEp) {
        finishedEp.is_played = 1;
        const total = Math.floor(finishedEp.duration || media.duration || 0);
        finishedEp.position = total;

        // Optimistically remove finished card from Continue Listening carousel immediately
        if (el.continueGrid) {
          const card = el.continueGrid.querySelector(`.continue-card[data-episode-id="${finishedEp.id}"]`);
          if (card) {
            card.remove();
            if (el.continueGrid.children.length === 0 && el.continueSection) {
              el.continueSection.style.display = 'none';
            }
          }
        }

        try {
          await fetch(`/api/episodes/${finishedEp.id}/state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ position: total, total, is_played: 1, action: 'play' })
          });
        } catch (e) {}
      }

      dismissPlayer();

      if (state.currentPodcast) {
        renderEpisodesList();
      }
      await loadInProgressEpisodes();
    });

    media.addEventListener('play', () => {
      state.isPlaying = true;
      updatePlayPauseIcons(true);
      startSyncHeartbeat();
    });

    media.addEventListener('pause', () => {
      state.isPlaying = false;
      updatePlayPauseIcons(false);
      stopSyncHeartbeat();
    });
  }

  setupMediaEventListeners(el.nativeAudio);
  setupMediaEventListeners(el.nowplayingVideo);

  // Scrubber events
  function handleScrubberInput(val) {
    const media = getActiveMediaElement();
    if (media.duration) {
      media.currentTime = (val / 100) * media.duration;
    }
  }

  el.playerScrubber.addEventListener('input', (e) => handleScrubberInput(e.target.value));
  el.nowplayingScrubber.addEventListener('input', (e) => handleScrubberInput(e.target.value));
  if (el.videoFsScrubber) {
    el.videoFsScrubber.addEventListener('input', (e) => {
      handleScrubberInput(e.target.value);
      resetFsControlsTimer();
    });
  }

  // Speed and Volume
  function syncSpeedSelect(selectEl, rate) {
    if (!selectEl) return;
    const numRate = parseFloat(rate);
    for (const opt of selectEl.options) {
      if (Math.abs(parseFloat(opt.value) - numRate) < 0.01) {
        opt.selected = true;
        return;
      }
    }
    selectEl.value = numRate.toString();
  }

  function setPlaybackRate(rate) {
    state.playbackRate = parseFloat(rate);
    syncSpeedSelect(el.playerSpeed, state.playbackRate);
    syncSpeedSelect(el.videoFsSpeedSelect, state.playbackRate);
    el.nativeAudio.playbackRate = state.playbackRate;
    el.nowplayingVideo.playbackRate = state.playbackRate;
  }

  el.playerSpeed.addEventListener('change', (e) => setPlaybackRate(e.target.value));
  if (el.videoFsSpeedSelect) {
    el.videoFsSpeedSelect.addEventListener('change', (e) => {
      setPlaybackRate(e.target.value);
      resetFsControlsTimer();
    });
  }

  function updateVolumeUI() {
    el.nativeAudio.volume = state.volume;
    el.nowplayingVideo.volume = state.volume;
    el.nativeAudio.muted = state.isMuted;
    el.nowplayingVideo.muted = state.isMuted;
    el.volumeSlider.value = state.isMuted ? 0 : state.volume;
    if (el.videoFsVolumeSlider) {
      el.videoFsVolumeSlider.value = state.isMuted ? 0 : state.volume;
    }

    if (state.isMuted || state.volume === 0) {
      el.iconVolHigh.style.display = 'none';
      el.iconVolMute.style.display = 'block';
      if (el.videoFsIconVolHigh) el.videoFsIconVolHigh.style.display = 'none';
      if (el.videoFsIconVolMute) el.videoFsIconVolMute.style.display = 'block';
    } else {
      el.iconVolHigh.style.display = 'block';
      el.iconVolMute.style.display = 'none';
      if (el.videoFsIconVolHigh) el.videoFsIconVolHigh.style.display = 'block';
      if (el.videoFsIconVolMute) el.videoFsIconVolMute.style.display = 'none';
    }
  }

  el.volumeSlider.addEventListener('input', (e) => {
    state.volume = parseFloat(e.target.value);
    state.isMuted = false;
    updateVolumeUI();
  });

  el.btnVolumeToggle.addEventListener('click', () => {
    state.isMuted = !state.isMuted;
    updateVolumeUI();
  });

  if (el.videoFsVolumeSlider) {
    el.videoFsVolumeSlider.addEventListener('input', (e) => {
      state.volume = parseFloat(e.target.value);
      state.isMuted = false;
      updateVolumeUI();
      resetFsControlsTimer();
    });
  }

  if (el.btnVideoFsVolumeToggle) {
    el.btnVideoFsVolumeToggle.addEventListener('click', () => {
      state.isMuted = !state.isMuted;
      updateVolumeUI();
      resetFsControlsTimer();
    });
  }

  // MediaSession API Integration (Hardware & Lock Screen Controls)
  function updateMediaSession(episode, podcast) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: decodeHtml(episode.title),
        artist: decodeHtml(podcast.author || podcast.title),
        album: decodeHtml(podcast.title),
        artwork: [
          { src: episode.image_url || podcast.image_url || '', sizes: '512x512', type: 'image/jpeg' }
        ]
      });

      navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('seekbackward', () => skipBackward());
      navigator.mediaSession.setActionHandler('seekforward', () => skipForward());
      navigator.mediaSession.setActionHandler('previoustrack', () => playPreviousTrack());
      navigator.mediaSession.setActionHandler('nexttrack', () => playNextTrack());
    }
  }

  // Settings Loader & Handlers
  async function loadSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.config) {
        state.config.skip_forward_sec = data.config.skip_forward_sec;
        state.config.skip_back_sec = data.config.skip_back_sec;
        updateSkipBadges();
      }

      // Update sync URLs with current hostname
      const host = window.location.origin;
      el.boxNextcloudUrl.textContent = `${host}`;
      el.boxGpodderUrl.textContent = `${host}`;

      // Render connected devices
      if (data.devices && data.devices.length > 0) {
        el.devicesContainer.innerHTML = `
          <table style="width: 100%; border-collapse: collapse; margin-top: 0.5rem;">
            <thead>
              <tr style="border-bottom: 1px solid var(--theme-border); text-align: left;">
                <th style="padding: 0.5rem;">Device</th>
                <th style="padding: 0.5rem;">Type</th>
                <th style="padding: 0.5rem;">Last Synchronized</th>
              </tr>
            </thead>
            <tbody>
              ${data.devices.map(d => `
                <tr style="border-bottom: 1px solid var(--ctp-surface0);">
                  <td style="padding: 0.5rem; font-weight: 600;">${escapeHtml(d.caption || d.id)}</td>
                  <td style="padding: 0.5rem;">${escapeHtml(d.type || 'phone')}</td>
                  <td style="padding: 0.5rem; color: var(--theme-muted);">${d.last_sync_at ? new Date(d.last_sync_at * 1000).toLocaleString() : 'Never'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } else {
        el.devicesContainer.innerHTML = '<em>No devices synced yet. Once AntennaPod connects, it will appear here.</em>';
      }
    } catch (e) {
      showToast('Error loading settings: ' + e.message, true);
    }
  }

  el.formPlaybackSettings.addEventListener('submit', async (e) => {
    e.preventDefault();
    const skipBack = parseInt(el.settingSkipBack.value, 10) || 10;
    const skipFwd = parseInt(el.settingSkipForward.value, 10) || 30;
    const theme = el.settingTheme.value;

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skip_forward_sec: skipFwd,
          skip_back_sec: skipBack,
          theme
        })
      });
      const data = await res.json();
      if (data.success) {
        state.config.skip_forward_sec = skipFwd;
        state.config.skip_back_sec = skipBack;
        updateSkipBadges();
        applyTheme(theme);
        showToast('Settings saved successfully');
      }
    } catch (err) {
      showToast('Failed to save settings: ' + err.message, true);
    }
  });

  el.formChangePassword.addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPassword = el.inputOldPass.value;
    const newPassword = el.inputNewPass.value;

    try {
      const res = await fetch('/api/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Password updated successfully');
        el.inputOldPass.value = '';
        el.inputNewPass.value = '';
      } else {
        showToast(data.error || 'Failed to update password', true);
      }
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  });

  // OPML File Import Handler
  async function handleOpmlFileImport(file, statusEl = null) {
    if (!file) return;
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.color = 'var(--theme-muted)';
      statusEl.textContent = `Reading ${file.name}...`;
    }
    showToast(`Importing OPML (${file.name})...`);

    try {
      const xmlText = await file.text();
      const res = await fetch('/api/library/import.opml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: xmlText
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        const msg = data.error || 'Failed to import OPML';
        if (statusEl) {
          statusEl.style.color = 'var(--ctp-red)';
          statusEl.textContent = msg;
        }
        showToast(msg, true);
        return;
      }

      const msg = data.message || `Imported ${data.imported} podcast subscription(s).`;
      if (statusEl) {
        statusEl.style.color = 'var(--ctp-green)';
        statusEl.textContent = msg;
      }
      showToast(msg);

      if (el.modalAddPodcast && el.modalAddPodcast.classList.contains('active')) {
        el.modalAddPodcast.classList.remove('active');
      }

      loadLibrary();
    } catch (err) {
      const msg = 'Error importing OPML: ' + err.message;
      if (statusEl) {
        statusEl.style.color = 'var(--ctp-red)';
        statusEl.textContent = msg;
      }
      showToast(msg, true);
    }
  }

  if (el.inputImportOpml) {
    el.inputImportOpml.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        await handleOpmlFileImport(file, el.importOpmlStatus);
        e.target.value = '';
      }
    });
  }

  if (el.inputModalImportOpml) {
    el.inputModalImportOpml.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        await handleOpmlFileImport(file);
        e.target.value = '';
      }
    });
  }

  // Subscribe / Add Feed Logic
  el.formAddFeed.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = el.inputFeedUrl.value.trim();
    if (!url) return;

    el.btnSubmitFeed.disabled = true;
    el.btnSubmitFeed.textContent = 'Subscribing & Syncing...';

    try {
      const res = await fetch('/api/library/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Subscribed! Feed will sync to AntennaPod on next refresh.');
        el.modalAddPodcast.classList.remove('active');
        el.inputFeedUrl.value = '';
        loadLibrary();
      } else {
        showToast(data.error || 'Failed to subscribe', true);
      }
    } catch (err) {
      showToast('Error subscribing: ' + err.message, true);
    } finally {
      el.btnSubmitFeed.disabled = false;
      el.btnSubmitFeed.textContent = 'Subscribe via URL';
    }
  });

  // Podcast Search
  el.btnSearchPodcast.addEventListener('click', async () => {
    const q = el.inputSearchPodcast.value.trim();
    if (!q) return;

    el.btnSearchPodcast.disabled = true;
    el.btnSearchPodcast.textContent = 'Searching...';
    el.searchResults.style.display = 'none';
    el.searchResults.innerHTML = '';

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        el.searchResults.style.display = 'block';
        data.results.forEach(r => {
          const item = document.createElement('div');
          item.className = 'search-result-item';
          item.innerHTML = `
            <img class="search-result-img" src="${r.imageUrl || ''}" alt="">
            <div class="search-result-info">
              <div class="search-result-title">${escapeHtml(r.title)}</div>
              <div class="search-result-author">${escapeHtml(r.author || '')}</div>
            </div>
            <button class="btn btn-secondary btn-search-sub" style="font-size: 0.75rem; padding: 0.35rem 0.6rem;">Subscribe</button>
          `;
          const subBtn = item.querySelector('.btn-search-sub');
          subBtn.addEventListener('click', async () => {
            subBtn.disabled = true;
            subBtn.textContent = 'Adding...';
            try {
              const subRes = await fetch('/api/library/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: r.feedUrl })
              });
              const subData = await subRes.json();
              if (subData.success) {
                showToast(`Subscribed to ${r.title}! Synced.`);
                el.modalAddPodcast.classList.remove('active');
                loadLibrary();
              } else {
                showToast(subData.error || 'Failed to subscribe', true);
                subBtn.disabled = false;
                subBtn.textContent = 'Subscribe';
              }
            } catch (err) {
              showToast('Error subscribing: ' + err.message, true);
              subBtn.disabled = false;
              subBtn.textContent = 'Subscribe';
            }
          });
          el.searchResults.appendChild(item);
        });
      } else {
        el.searchResults.style.display = 'block';
        el.searchResults.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--theme-muted);">No podcasts found.</div>';
      }
    } catch (err) {
      showToast('Search failed: ' + err.message, true);
    } finally {
      el.btnSearchPodcast.disabled = false;
      el.btnSearchPodcast.textContent = 'Search';
    }
  });

  // Unsubscribe
  el.btnPodcastUnsubscribe.addEventListener('click', async () => {
    if (!state.currentPodcast) return;
    const confirmed = confirm(`Are you sure you want to unsubscribe from "${state.currentPodcast.title}"?\n\nThis will also unsubscribe in AntennaPod on next sync.`);
    if (!confirmed) return;

    try {
      const res = await fetch('/api/library/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: state.currentPodcast.url })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Unsubscribed. Removal will sync to AntennaPod.');
        switchView('library');
      }
    } catch (e) {
      showToast('Failed to unsubscribe: ' + e.message, true);
    }
  });

  // Refresh Feed
  el.btnPodcastRefresh.addEventListener('click', async () => {
    if (!state.currentPodcast) return;
    el.btnPodcastRefresh.disabled = true;
    showToast('Refreshing feed...');
    try {
      await fetch('/api/library/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ podcastId: state.currentPodcast.id })
      });
      showToast('Feed refreshed');
      openPodcastDetail(state.currentPodcast.id);
    } catch (e) {
      showToast('Failed to refresh feed', true);
    } finally {
      el.btnPodcastRefresh.disabled = false;
    }
  });

  el.btnRefreshAll.addEventListener('click', async () => {
    el.btnRefreshAll.disabled = true;
    showToast('Refreshing all podcast feeds in background...');
    try {
      const res = await fetch('/api/library/refresh', { method: 'POST' });
      const data = await res.json();
      showToast(`Refreshed ${data.refreshed || 0} feeds`);
      loadLibrary();
    } catch (e) {
      showToast('Refresh error: ' + e.message, true);
    } finally {
      el.btnRefreshAll.disabled = false;
    }
  });

  // Mark all episodes of current podcast as played
  if (el.btnPodcastMarkAllPlayed) {
    el.btnPodcastMarkAllPlayed.addEventListener('click', async () => {
      if (!state.currentPodcast) return;
      const unplayedCount = state.currentEpisodes.filter(e => !e.is_played).length;
      if (unplayedCount === 0) {
        showToast('All episodes are already marked as played');
        return;
      }
      if (!confirm(`Mark all ${unplayedCount} unplayed episode${unplayedCount === 1 ? '' : 's'} as played?`)) {
        return;
      }
      try {
        const res = await fetch(`/api/podcasts/${state.currentPodcast.id}/mark-all-played`, {
          method: 'POST'
        });
        const data = await res.json();
        if (data.success) {
          state.currentEpisodes.forEach(ep => {
            ep.is_played = 1;
            ep.position = ep.duration || ep.total_duration || 0;
          });
          if (state.multiSelectMode) {
            setMultiSelectMode(false);
          } else {
            renderEpisodesList();
          }
          loadInProgressEpisodes();
          showToast(`Marked ${data.count} episode${data.count === 1 ? '' : 's'} as played (synced)`);
        } else {
          showToast('Failed to mark episodes as played', true);
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
      }
    });
  }

  // Multi-select Mode & Batch Actions
  if (el.btnToggleMultiSelect) {
    el.btnToggleMultiSelect.addEventListener('click', () => {
      setMultiSelectMode(!state.multiSelectMode);
    });
  }

  if (el.btnBatchSelectAll) {
    el.btnBatchSelectAll.addEventListener('click', () => {
      const filtered = getFilteredEpisodes();
      filtered.forEach(ep => state.selectedEpisodeIds.add(ep.id));
      updateBatchCount();
      renderEpisodesList();
    });
  }

  if (el.btnBatchDeselectAll) {
    el.btnBatchDeselectAll.addEventListener('click', () => {
      state.selectedEpisodeIds.clear();
      updateBatchCount();
      renderEpisodesList();
    });
  }

  if (el.btnBatchCancel) {
    el.btnBatchCancel.addEventListener('click', () => {
      setMultiSelectMode(false);
    });
  }

  if (el.btnBatchMarkPlayed) {
    el.btnBatchMarkPlayed.addEventListener('click', async () => {
      const ids = Array.from(state.selectedEpisodeIds);
      if (ids.length === 0) {
        showToast('No episodes selected', true);
        return;
      }
      try {
        const res = await fetch('/api/episodes/mark-played-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ episodeIds: ids })
        });
        const data = await res.json();
        if (data.success) {
          const idSet = new Set(ids);
          state.currentEpisodes.forEach(ep => {
            if (idSet.has(ep.id)) {
              ep.is_played = 1;
              ep.position = ep.duration || ep.total_duration || 0;
            }
          });
          setMultiSelectMode(false);
          renderEpisodesList();
          loadInProgressEpisodes();
          showToast(`Marked ${data.count} episode${data.count === 1 ? '' : 's'} as played (synced)`);
        } else {
          showToast('Failed to mark episodes as played', true);
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
      }
    });
  }

  // Episode Search & Filter Event Handlers
  el.episodeSearchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    renderEpisodesList();
  });

  el.filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      updateFilterButtons();
      renderEpisodesList();
    });
  });

  // Library Search
  if (el.podcastSearchInput) {
    el.podcastSearchInput.addEventListener('input', (e) => {
      state.librarySearchQuery = e.target.value.trim();
      renderLibrary();
    });

    el.podcastSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.librarySearchQuery) {
        e.preventDefault();
        state.librarySearchQuery = '';
        el.podcastSearchInput.value = '';
        renderLibrary();
      }
    });
  }

  if (el.btnEmptyClearSearch) {
    el.btnEmptyClearSearch.addEventListener('click', () => {
      state.librarySearchQuery = '';
      if (el.podcastSearchInput) el.podcastSearchInput.value = '';
      renderLibrary();
    });
  }

  // Library Sorting & Filtering
  if (el.podcastSortSelect) {
    el.podcastSortSelect.value = state.podcastSort;
    const handleSortChange = (e) => {
      state.podcastSort = e.target.value;
      localStorage.setItem('antennapodder_podcast_sort', state.podcastSort);
      renderLibrary();
    };
    el.podcastSortSelect.addEventListener('change', handleSortChange);
    el.podcastSortSelect.addEventListener('input', handleSortChange);
  }

  if (el.filterPodAll) {
    el.filterPodAll.addEventListener('click', () => {
      state.podcastFilter = 'all';
      el.filterPodAll.classList.add('active');
      el.filterPodFavs.classList.remove('active');
      renderLibrary();
    });
  }

  if (el.filterPodFavs) {
    el.filterPodFavs.addEventListener('click', () => {
      state.podcastFilter = 'favs';
      el.filterPodFavs.classList.add('active');
      el.filterPodAll.classList.remove('active');
      renderLibrary();
    });
  }

  // Podcast Detail Favorite Button
  if (el.btnPodcastFavorite) {
    el.btnPodcastFavorite.addEventListener('click', async () => {
      if (!state.currentPodcast) return;
      await togglePodcastFavoriteApi(state.currentPodcast.id);
    });
  }

  // Controls Event Binding
  el.btnPlayPause.addEventListener('click', togglePlayPause);
  el.btnModalPlayPause.addEventListener('click', togglePlayPause);
  el.btnSkipBack.addEventListener('click', skipBackward);
  el.btnModalSkipBack.addEventListener('click', skipBackward);
  el.btnSkipForward.addEventListener('click', skipForward);
  el.btnModalSkipForward.addEventListener('click', skipForward);
  el.btnPrevTrack.addEventListener('click', playPreviousTrack);
  el.btnModalPrev.addEventListener('click', playPreviousTrack);
  el.btnNextTrack.addEventListener('click', playNextTrack);
  el.btnModalNext.addEventListener('click', playNextTrack);

  // Modals & Navigation Binding
  el.brand.addEventListener('click', () => switchView('library'));
  el.btnNavLibrary.addEventListener('click', () => switchView('library'));
  el.btnNavSettings.addEventListener('click', () => switchView('settings'));
  el.btnPodcastBack.addEventListener('click', () => switchView('library'));
  el.btnThemeToggle.addEventListener('click', toggleTheme);

  el.playerTrackClick.addEventListener('click', () => el.modalNowPlaying.classList.add('active'));
  el.btnExpandNowplaying.addEventListener('click', () => el.modalNowPlaying.classList.add('active'));
  el.btnCloseNowplaying.addEventListener('click', () => el.modalNowPlaying.classList.remove('active'));

  if (el.nowplayingPodcast) {
    el.nowplayingPodcast.addEventListener('click', () => {
      const podcastId = state.activePodcast?.id || state.activeEpisode?.podcast_id;
      if (podcastId) {
        el.modalNowPlaying.classList.remove('active');
        openPodcastDetail(podcastId);
      }
    });
  }

  if (el.btnPlayerFullscreenVideo) {
    el.btnPlayerFullscreenVideo.addEventListener('click', toggleVideoFullscreen);
  }
  if (el.btnVideoOverlayFullscreen) {
    el.btnVideoOverlayFullscreen.addEventListener('click', toggleVideoFullscreen);
  }

  // Fullscreen video controls binding
  if (el.btnVideoFsPlayPause) {
    el.btnVideoFsPlayPause.addEventListener('click', () => { togglePlayPause(); resetFsControlsTimer(); });
  }
  if (el.btnVideoFsSkipBack) {
    el.btnVideoFsSkipBack.addEventListener('click', () => { skipBackward(); resetFsControlsTimer(); });
  }
  if (el.btnVideoFsSkipForward) {
    el.btnVideoFsSkipForward.addEventListener('click', () => { skipForward(); resetFsControlsTimer(); });
  }
  if (el.btnVideoFsPrev) {
    el.btnVideoFsPrev.addEventListener('click', () => { playPreviousTrack(); resetFsControlsTimer(); });
  }
  if (el.btnVideoFsNext) {
    el.btnVideoFsNext.addEventListener('click', () => { playNextTrack(); resetFsControlsTimer(); });
  }
  if (el.btnVideoFsExit) {
    el.btnVideoFsExit.addEventListener('click', toggleVideoFullscreen);
  }

  // Fullscreen activity tracking & video click handlers
  if (el.nowplayingVideoWrapper) {
    el.nowplayingVideoWrapper.addEventListener('mousemove', resetFsControlsTimer);
    el.nowplayingVideoWrapper.addEventListener('touchstart', resetFsControlsTimer, { passive: true });
  }
  if (el.videoFsPlayerBar) {
    el.videoFsPlayerBar.addEventListener('mouseenter', () => clearTimeout(fsControlsTimeout));
    el.videoFsPlayerBar.addEventListener('mouseleave', resetFsControlsTimer);
  }
  if (el.videoFsTopBar) {
    el.videoFsTopBar.addEventListener('mouseenter', () => clearTimeout(fsControlsTimeout));
    el.videoFsTopBar.addEventListener('mouseleave', resetFsControlsTimer);
  }

  let videoClickTimeout = null;
  if (el.nowplayingVideo) {
    el.nowplayingVideo.addEventListener('click', (e) => {
      if (e.target.closest('#video-fs-player-bar') || e.target.closest('#video-fs-top-bar') || e.target.closest('#btn-video-overlay-fullscreen')) return;
      if (videoClickTimeout) {
        clearTimeout(videoClickTimeout);
        videoClickTimeout = null;
        return;
      }
      videoClickTimeout = setTimeout(() => {
        videoClickTimeout = null;
        togglePlayPause();
        resetFsControlsTimer();
      }, 250);
    });
    el.nowplayingVideo.addEventListener('dblclick', (e) => {
      if (videoClickTimeout) {
        clearTimeout(videoClickTimeout);
        videoClickTimeout = null;
      }
      toggleVideoFullscreen();
    });
  }

  el.btnOpenAdd.addEventListener('click', () => el.modalAddPodcast.classList.add('active'));
  el.btnEmptyAdd.addEventListener('click', () => el.modalAddPodcast.classList.add('active'));
  el.btnCloseAdd.addEventListener('click', () => el.modalAddPodcast.classList.remove('active'));

  // Episode Details Modal Listeners
  if (el.btnCloseEpisodeDetails) {
    el.btnCloseEpisodeDetails.addEventListener('click', () => {
      if (el.modalEpisodeDetails) el.modalEpisodeDetails.classList.remove('active');
    });
  }

  if (el.btnEpisodeDetailPlay) {
    el.btnEpisodeDetailPlay.addEventListener('click', () => {
      const ep = state.selectedDetailEpisode;
      if (!ep) return;
      const isCurrentActive = state.activeEpisode && state.activeEpisode.id === ep.id;
      if (isCurrentActive) {
        togglePlayPause();
      } else {
        playEpisode(ep, state.currentPodcast);
      }
      updateEpisodeDetailPlayBtn(ep);
    });
  }

  // Close modals when clicking overlay background
  [el.modalNowPlaying, el.modalAddPodcast, el.modalEpisodeDetails].forEach(modal => {
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('active');
        }
      });
    }
  });

  // Auth Login Form
  el.formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = el.loginUsername.value.trim();
    const password = el.loginPassword.value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.user) {
        state.user = data.user;
        el.modalLogin.classList.remove('active');
        el.loginError.style.display = 'none';
        handleHashRoute();
      } else {
        el.loginError.textContent = data.error || 'Login failed';
        el.loginError.style.display = 'block';
      }
    } catch (err) {
      el.loginError.textContent = err.message;
      el.loginError.style.display = 'block';
    }
  });

  el.btnLogout.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.reload();
  });

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    resetFsControlsTimer();

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      skipBackward();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      skipForward();
    } else if (e.code === 'KeyM') {
      el.btnVolumeToggle.click();
    } else if (e.code === 'KeyF' && state.isVideo) {
      e.preventDefault();
      toggleVideoFullscreen();
    } else if (e.code === 'Escape') {
      el.modalNowPlaying.classList.remove('active');
      el.modalAddPodcast.classList.remove('active');
      if (el.modalEpisodeDetails) el.modalEpisodeDetails.classList.remove('active');
    }
  });

  // Utility: HTML Decoding and Escaping
  function decodeHtml(html) {
    if (!html || typeof html !== 'string' || !html.includes('&')) return html || '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  }

  function escapeHtml(str) {
    if (!str) return '';
    const decoded = decodeHtml(str);
    return String(decoded)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cleanSnippet(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const text = tmp.textContent || tmp.innerText || '';
    return escapeHtml(text.slice(0, 150) + (text.length > 150 ? '...' : ''));
  }

  // Initialization
  const savedTheme = localStorage.getItem('antennapodder_theme') || 'mocha';
  applyTheme(savedTheme);

  async function initApp() {
    const authenticated = await checkAuth();
    if (authenticated) {
      handleHashRoute();
    }
  }
  initApp();

})();
