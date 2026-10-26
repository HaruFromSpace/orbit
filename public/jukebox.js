// ==========================================================================
// JUKEBOX & SONG QUEUE MODULE
// ==========================================================================

(() => {
    // --- Elements ---
    const jukeboxBtn = document.getElementById('jukeboxBtn');
    const jukeboxModal = document.getElementById('jukeboxModal');
    const closeJukeboxBtn = document.getElementById('closeJukeboxBtn');
    const songSearchInput = document.getElementById('songSearchInput');
    const searchSongsBtn = document.getElementById('searchSongsBtn');
    const searchResultsList = document.getElementById('searchResultsList');

    const currentDjBadge = document.getElementById('currentMusicBadge') || document.getElementById('currentDjBadge');
    const becomeDjBtn = document.getElementById('becomeMusicHostBtn') || document.getElementById('becomeDjBtn');
    const openDjDeckBtn = document.getElementById('openMusicDeckBtn') || document.getElementById('openDjDeckBtn');
    const playNextBtn = document.getElementById('playNextBtn');

    const nowPlayingTitle = document.getElementById('nowPlayingTitle');
    const nowPlayingDetails = document.getElementById('nowPlayingDetails');
    const nowPlayingActions = document.getElementById('nowPlayingActions');
    const jukeboxQueueList = document.getElementById('jukeboxQueueList');

    let currentJukeboxState = { currentDJ: null, nowPlaying: null, queue: [] };

    // --- Open Music Deck Tab ---
    function openDjDeckWindow() {
        const room = getRoom();
        window.open('/dj.html?room=' + encodeURIComponent(room), 'watchparty_dj_deck');
    }

    if (openDjDeckBtn) {
        openDjDeckBtn.addEventListener('click', openDjDeckWindow);
    }

    const headerDjDeckBtn = document.getElementById('headerMusicDeckBtn') || document.getElementById('headerDjDeckBtn');
    if (headerDjDeckBtn) {
        headerDjDeckBtn.addEventListener('click', openDjDeckWindow);
    }

    const bannerDjDeckBtn = document.getElementById('bannerMusicDeckBtn') || document.getElementById('bannerDjDeckBtn');
    if (bannerDjDeckBtn) {
        bannerDjDeckBtn.addEventListener('click', openDjDeckWindow);
    }

    // --- Modal Navigation ---
    if (jukeboxBtn && jukeboxModal) {
        jukeboxBtn.addEventListener('click', () => {
            jukeboxModal.classList.remove('hidden');
            requestJukeboxState();
        });
    }

    if (closeJukeboxBtn && jukeboxModal) {
        closeJukeboxBtn.addEventListener('click', () => {
            jukeboxModal.classList.add('hidden');
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && jukeboxModal && !jukeboxModal.classList.contains('hidden')) {
            jukeboxModal.classList.add('hidden');
        }
    });

    // --- Helpers ---
    function getRoom() {
        return window.getCurrentRoom ? window.getCurrentRoom() : '';
    }

    function getUser() {
        return window.getCurrentUser ? window.getCurrentUser() : 'Anonymous';
    }

    function requestJukeboxState() {
        const room = getRoom();
        if (window.appSocket && room) {
            window.appSocket.emit('jukeboxGet', { room });
        }
    }

    // --- Search Logic ---
    async function performSearch() {
        if (!songSearchInput) return;
        const query = songSearchInput.value.trim();
        if (!query) return;

        searchResultsList.classList.remove('hidden');
        searchResultsList.innerHTML = '<div style="padding: 12px; font-size: 0.8rem; color: var(--text-secondary); text-align: center;">Searching YouTube... (正在搜索...)</div>';

        try {
            const res = await fetch('/api/search-songs?q=' + encodeURIComponent(query));
            const videos = await res.json();
            renderSearchResults(videos);
        } catch (err) {
            console.error('Song search failed:', err);
            searchResultsList.innerHTML = '<div style="padding: 12px; font-size: 0.8rem; color: #f87171; text-align: center;">Search failed. Please try again.</div>';
        }
    }

    if (searchSongsBtn) {
        searchSongsBtn.addEventListener('click', performSearch);
    }

    if (songSearchInput) {
        songSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performSearch();
            }
        });
    }

    function renderSearchResults(videos) {
        if (!searchResultsList) return;
        searchResultsList.innerHTML = '';

        if (!videos || videos.length === 0) {
            searchResultsList.innerHTML = '<div style="padding: 12px; font-size: 0.8rem; color: var(--text-muted); text-align: center;">No results found. (未找到结果)</div>';
            return;
        }

        videos.forEach(video => {
            const item = document.createElement('div');
            item.className = 'search-result-item';

            const thumb = document.createElement('img');
            thumb.className = 'sr-thumb';
            thumb.src = video.thumbnail || '';
            thumb.alt = video.title;
            thumb.loading = 'lazy';

            const info = document.createElement('div');
            info.className = 'sr-info';

            const title = document.createElement('div');
            title.className = 'sr-title';
            title.textContent = video.title;
            title.title = video.title;

            const meta = document.createElement('div');
            meta.className = 'sr-meta';
            meta.textContent = `${video.author} • ${video.timestamp || ''}`;

            info.appendChild(title);
            info.appendChild(meta);

            const addBtn = document.createElement('button');
            addBtn.className = 'sr-add-btn';
            addBtn.textContent = '+ Add 加歌';
            addBtn.addEventListener('click', () => {
                const room = getRoom();
                const user = getUser();
                if (window.appSocket && room) {
                    window.appSocket.emit('jukeboxAdd', { room, song: video, user });
                    addBtn.textContent = 'Added 已添加';
                    addBtn.disabled = true;
                    setTimeout(() => {
                        searchResultsList.classList.add('hidden');
                        songSearchInput.value = '';
                    }, 600);
                }
            });

            item.appendChild(thumb);
            item.appendChild(info);
            item.appendChild(addBtn);

            searchResultsList.appendChild(item);
        });
    }

    // --- Queue Management ---
    if (becomeDjBtn) {
        becomeDjBtn.addEventListener('click', () => {
            const room = getRoom();
            const user = getUser();
            if (window.appSocket && room) {
                window.appSocket.emit('jukeboxSetDJ', { room, user });
            }
        });
    }

    if (playNextBtn) {
        let playNextCooldown = false;
        playNextBtn.addEventListener('click', () => {
            if (playNextCooldown) return;
            playNextCooldown = true;
            playNextBtn.disabled = true;
            setTimeout(() => {
                playNextCooldown = false;
                playNextBtn.disabled = false;
            }, 1800);
            const room = getRoom();
            if (window.appSocket && room) {
                window.appSocket.emit('jukeboxPlayNext', { room });
            }
        });
    }

    function renderJukeboxUI(state) {
        currentJukeboxState = state || { currentDJ: null, nowPlaying: null, queue: [], history: [] };

        // Music Host Badge
        if (currentDjBadge) {
            currentDjBadge.textContent = currentJukeboxState.currentDJ ? `Music: ${currentJukeboxState.currentDJ}` : 'Music: None';
        }

        // Now Playing
        if (currentJukeboxState.nowPlaying) {
            const np = currentJukeboxState.nowPlaying;
            nowPlayingTitle.textContent = np.title;
            nowPlayingDetails.textContent = `${np.author} • ${np.timestamp || ''} • Requested by ${np.user}`;

            nowPlayingActions.innerHTML = '';
            
            // Primary action: Open/focus dedicated Music deck tab
            const deckBtn = document.createElement('button');
            deckBtn.className = 'control-btn primary mini';
            deckBtn.textContent = 'Music Deck 控制台';
            deckBtn.title = 'Open/Focus persistent player tab (auto-plays and advances)';
            deckBtn.addEventListener('click', openDjDeckWindow);
            nowPlayingActions.appendChild(deckBtn);

            // Secondary action: Direct YouTube link using persistent window name
            const playLink = document.createElement('a');
            playLink.className = 'dj-play-link';
            playLink.href = np.url;
            playLink.target = 'watchparty_dj_deck';
            playLink.rel = 'noopener noreferrer';
            playLink.textContent = 'YouTube 单标签页';
            nowPlayingActions.appendChild(playLink);
        } else {
            nowPlayingTitle.textContent = 'No song active';
            nowPlayingDetails.textContent = 'Requested songs will appear here';
            nowPlayingActions.innerHTML = '';
        }

        // Queue List
        if (jukeboxQueueList) {
            jukeboxQueueList.innerHTML = '';
            const queue = currentJukeboxState.queue || [];
            const history = currentJukeboxState.history || [];

            if (queue.length === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.className = 'queue-empty-msg';
                emptyMsg.textContent = 'Queue is empty. Search songs above to add! (暂无点歌)';
                jukeboxQueueList.appendChild(emptyMsg);
            } else {
                queue.forEach((item, index) => {
                    const row = document.createElement('div');
                    row.className = 'queue-item';

                    const info = document.createElement('div');
                    info.className = 'queue-item-info';

                    const title = document.createElement('div');
                    title.className = 'queue-item-title';
                    title.textContent = `${index + 1}. ${item.title}`;
                    title.title = item.title;

                    const by = document.createElement('div');
                    by.className = 'queue-item-by';
                    by.textContent = `${item.timestamp || ''} • Requested by ${item.user}`;

                    info.appendChild(title);
                    info.appendChild(by);

                    const actions = document.createElement('div');
                    actions.style.cssText = 'display: flex; align-items: center; gap: 6px;';

                    const removeBtn = document.createElement('button');
                    removeBtn.className = 'queue-remove-btn';
                    removeBtn.textContent = '✕';
                    removeBtn.title = 'Remove';
                    removeBtn.addEventListener('click', () => {
                        const room = getRoom();
                        if (window.appSocket && room) {
                            window.appSocket.emit('jukeboxRemove', { room, id: item.id });
                        }
                    });

                    actions.appendChild(removeBtn);
                    row.appendChild(info);
                    row.appendChild(actions);

                    jukeboxQueueList.appendChild(row);
                });
            }

            // Render Recently Played (History)
            if (history.length > 0) {
                const historyHeader = document.createElement('div');
                historyHeader.style.cssText = 'font-size: 0.76rem; font-weight: 600; color: var(--text-muted); margin-top: 14px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em;';
                historyHeader.textContent = 'Recently Played 最近播放';
                jukeboxQueueList.appendChild(historyHeader);

                history.forEach((item) => {
                    const row = document.createElement('div');
                    row.className = 'queue-item';
                    row.style.opacity = '0.75';

                    const info = document.createElement('div');
                    info.className = 'queue-item-info';

                    const title = document.createElement('div');
                    title.className = 'queue-item-title';
                    title.textContent = item.title;

                    const by = document.createElement('div');
                    by.className = 'queue-item-by';
                    by.textContent = `Played • ${item.author}`;

                    info.appendChild(title);
                    info.appendChild(by);

                    const replayBtn = document.createElement('button');
                    replayBtn.className = 'control-btn secondary mini';
                    replayBtn.style.cssText = 'padding: 2px 8px; font-size: 0.7rem; height: 24px;';
                    replayBtn.textContent = '+ Replay 重播';
                    replayBtn.addEventListener('click', () => {
                        const room = getRoom();
                        const user = getUser();
                        if (window.appSocket && room) {
                            window.appSocket.emit('jukeboxReplaySong', { room, song: item, user });
                        }
                    });

                    row.appendChild(info);
                    row.appendChild(replayBtn);
                    jukeboxQueueList.appendChild(row);
                });
            }
        }
    }

    // --- Socket Listeners ---
    if (window.appSocket) {
        window.appSocket.on('jukeboxUpdate', (state) => {
            renderJukeboxUI(state);
        });

        window.appSocket.on('connect', () => {
            requestJukeboxState();
        });
    }
})();
