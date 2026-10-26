const socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    timeout: 20000
});

// Auto-rejoin room if socket drops and reconnects
socket.on('connect', () => {
    if (currentRoom) {
        socket.emit('joinRoom', { room: currentRoom, username });
    }
});

// DOM Elements
const video = document.getElementById('syncVideo');
const videoUrlInput = document.getElementById('videoUrlInput');
const roomNameDisplay = document.getElementById('roomNameDisplay');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const joinModal = document.getElementById('joinModal');
const roomInput = document.getElementById('roomInput');
const usernameInput = document.getElementById('usernameInput');
const shareScreenBtn = document.getElementById('shareScreenBtn');
const ambientGlow = document.getElementById('ambientGlow');
const glowCtx = ambientGlow.getContext('2d');

// --- Initialize Plyr ---
const player = new Plyr('#syncVideo', {
    controls: ['play', 'progress', 'current-time', 'mute', 'volume', 'pip', 'fullscreen'],
    keyboard: { focused: true, global: true }
});

player.on('volumechange', () => {
    if (viewerAudioEl) {
        viewerAudioEl.volume = player.volume;
        viewerAudioEl.muted = player.muted;
    }
});

let currentRoom = '';
let username = '';
let isSyncing = false; // Flag to prevent echo loops
window.appSocket = socket;
window.getCurrentRoom = () => currentRoom;
window.getCurrentUser = () => username;

// --- Ambient Glow Logic ---
function drawGlow() {
    // Skip glow during screen share — srcObject is live capture, not video content
    if (!video.paused && !video.ended && !video.srcObject) {
        ambientGlow.width = video.videoWidth || 640;
        ambientGlow.height = video.videoHeight || 360;
        glowCtx.drawImage(video, 0, 0, ambientGlow.width, ambientGlow.height);
    }
    requestAnimationFrame(drawGlow);
}
// Start the animation loop
drawGlow();

// --- Room & Connection Logic ---
function connectToRoom() {
    const room = roomInput.value.trim();
    const name = usernameInput.value.trim();
    
    if (!room || !name) {
        alert("Please enter both a room ID and your alias.");
        return;
    }

    // Disconnect from old LiveKit room if switching rooms
    if (livekitRoom && currentRoom !== room) {
        livekitRoom.disconnect();
        livekitRoom = null;
    }

    currentRoom = room;
    username = name;
    localStorage.setItem('watchPartyUser', username);
    
    roomNameDisplay.textContent = currentRoom;
    joinModal.classList.add('hidden');
    
    // Send username so server can track participants
    socket.emit('joinRoom', { room: currentRoom, username });
    appendMessage('System', `Joined the void: ${currentRoom}`);
}

function joinNewRoom() {
    joinModal.classList.remove('hidden');
}

function copyInviteLink() {
    if (!currentRoom) return;
    const url = `${location.origin}?room=${encodeURIComponent(currentRoom)}`;
    navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('copyInviteBtn');
        const span = btn.querySelector('.btn-content');
        span.textContent = 'Copied!';
        setTimeout(() => span.textContent = 'Copy Invite', 2000);
    }).catch(() => {
        prompt('Copy this link:', url);
    });
}

window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    const userParam = urlParams.get('user');
    
    if (roomParam) roomInput.value = roomParam;
    
    const savedUser = localStorage.getItem('watchPartyUser');
    if (userParam) {
        usernameInput.value = userParam;
    } else if (savedUser) {
        usernameInput.value = savedUser;
    }

    // Auto-login if we already have both filled out
    if (roomInput.value && usernameInput.value && !userParam) {
        connectToRoom();
    }
};

// --- Video Proxy Logic ---
async function changeVideo() {
    const url = videoUrlInput.value.trim();
    if (url) {
        const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`;
        
        if (shareScreenBtn.classList.contains('sharing')) {
            await stopScreenShare();
        }

        video.srcObject = null;
        video.src = proxyUrl;
        
        // Sync the URL to all viewers so they load it too
        socket.emit('videoUrlChange', { room: currentRoom, url });
        socket.emit('chatMessage', { room: currentRoom, message: `Loaded new video source.`, user: 'System' });
    }
}

// --- Sync Logic (HTML5 Video) ---
video.addEventListener('play', () => {
    if (isSyncing) return;
    socket.emit('play', { room: currentRoom, time: video.currentTime });
});
video.addEventListener('pause', () => {
    if (isSyncing) return;
    socket.emit('pause', { room: currentRoom, time: video.currentTime });
});
video.addEventListener('seeked', () => {
    if (isSyncing) return;
    socket.emit('seek', { room: currentRoom, time: video.currentTime });
});

socket.on('syncState', (state) => {
    isSyncing = true;
    // Load video URL if we don't have one yet
    if (state.videoUrl && !video.src.includes('/proxy')) {
        const proxyUrl = `/proxy?url=${encodeURIComponent(state.videoUrl)}`;

        video.srcObject = null;
        video.src = proxyUrl;
    }
    video.currentTime = state.time || 0;
    if (state.playing) {
        video.play().catch(e => console.log('Autoplay blocked', e));
    } else {
        video.pause();
    }
    setTimeout(() => isSyncing = false, 100);
});

// Someone loaded a new video — load it on our end too
socket.on('videoUrlChange', (url) => {
    const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`;

    video.srcObject = null;
    video.src = proxyUrl;
    appendMessage('System', 'Host loaded a new video.');
});

socket.on('play', (time) => {
    isSyncing = true;
    if (Math.abs(video.currentTime - time) > 1.0) {
        video.currentTime = time;
    }
    video.play().catch(e => console.log('Autoplay blocked', e));
    setTimeout(() => isSyncing = false, 100);
});
socket.on('pause', (time) => {
    isSyncing = true;
    video.currentTime = time;
    video.pause();
    setTimeout(() => isSyncing = false, 100);
});
socket.on('seek', (time) => {
    isSyncing = true;
    video.currentTime = time;
    setTimeout(() => isSyncing = false, 100);
});

// Participant list
const participantAvatars = document.getElementById('participantAvatars');
socket.on('participantUpdate', (participants) => {
    if (participantAvatars) {
        participantAvatars.innerHTML = '';
        // Deduplicate in case of multi-tabs with the same username
        const uniqueParticipants = [...new Set(participants)];
        uniqueParticipants.forEach((name, index) => {
            const initial = name ? name.charAt(0).toUpperCase() : '?';
            const circle = document.createElement('div');
            circle.className = 'avatar-circle';
            circle.textContent = initial;
            circle.setAttribute('data-name', name);
            // Ensure proper z-index stacking so the first is on top
            circle.style.zIndex = 100 - index;
            participantAvatars.appendChild(circle);
        });

                // Resource management: Disable LiveKit screen share and connection if alone
        const isSharing = shareScreenBtn.classList.contains('sharing');
        const activeMusicBtn = document.getElementById('musicModeBtn') || document.getElementById('djModeBtn');
        const isMusicActive = activeMusicBtn && activeMusicBtn.classList.contains('broadcasting');

        if (uniqueParticipants.length <= 1) {
            if (isSharing) {
                stopScreenShare();
                appendMessage('System', 'Screen share stopped to save resources (room is empty).');
            }
            if (!isMusicActive && livekitRoom) {
                console.log('Disconnecting LiveKit to save minutes...');
                livekitRoom.disconnect();
                livekitRoom = null;
            }
            shareScreenBtn.disabled = true;
            shareScreenBtn.style.opacity = '0.5';
            shareScreenBtn.title = "Wait for someone to join before sharing";
            shareScreenBtn.querySelector('.btn-content').textContent = 'Waiting to Share';
        } else {
            if (!livekitRoom) {
                console.log('Other user joined. Connecting LiveKit...');
                connectLiveKit();
            }
            shareScreenBtn.disabled = false;
            shareScreenBtn.style.opacity = '1';
            shareScreenBtn.title = "Share Screen";
            if (!shareScreenBtn.classList.contains('sharing')) {
                shareScreenBtn.querySelector('.btn-content').textContent = 'Share 共享屏幕';
            }
        }
    }
});

// --- Chat Logic ---
const toggleStickersBtn = document.getElementById('toggleStickersBtn');
const stickerPanel = document.getElementById('stickerPanel');
const stickerGrid = document.getElementById('stickerGrid');
const gifSearchInput = document.getElementById('gifSearchInput');

// Fallback curated list of reaction gifs if the proxy fails
const DEFAULT_STICKERS = [
    "https://media.tenor.com/2sMePZ0PoyYAAAAC/anime-cheer.gif",
    "https://media.tenor.com/n1xJ8l8V-zMAAAAC/anime-cry.gif",
    "https://media.tenor.com/f_GBAqgU-H8AAAAC/anime-wow.gif",
    "https://media.tenor.com/9v1W31V3T28AAAAC/anime-laugh.gif",
    "https://media.tenor.com/n14A3J5bQxAAAAAC/anime-angry.gif",
    "https://media.tenor.com/1GvK_9M3E9EAAAAC/anime-sleep.gif",
    "https://media.tenor.com/gO2p5-q-oGEAAAAC/anime-eat.gif",
    "https://media.tenor.com/_q1EhlqZfB0AAAAC/anime-yes.gif",
    "https://media.tenor.com/bK1RvaXh7hQAAAAC/anime-nod.gif",
    "https://media.tenor.com/F4CjW5o7_nAAAAAC/anime-shock.gif"
];

function renderStickers(urls) {
    stickerGrid.innerHTML = '';
    urls.forEach(url => {
        const img = document.createElement('img');
        img.src = `/proxy?url=${encodeURIComponent(url)}`;
        img.addEventListener('click', () => {
            if (currentRoom) {
                socket.emit('chatMessage', { room: currentRoom, message: url, user: username });
                stickerPanel.classList.add('hidden');
            }
        });
        stickerGrid.appendChild(img);
    });
}

async function fetchGifs(query = '') {
    try {
        const res = await fetch(`/api/gifs?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        
        if (data.urls && data.urls.length > 0) {
            renderStickers(data.urls);
        } else {
            renderStickers(DEFAULT_STICKERS);
        }
    } catch (err) {
        console.error("Failed to fetch GIFs from proxy", err);
        renderStickers(DEFAULT_STICKERS);
    }
}

// Initial load via proxy
fetchGifs();

let searchTimeout;
gifSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        fetchGifs(e.target.value.trim());
    }, 500);
});

toggleStickersBtn.addEventListener('click', () => {
    stickerPanel.classList.toggle('hidden');
    if (!stickerPanel.classList.contains('hidden') && stickerGrid.children.length <= 10) {
        fetchGifs(gifSearchInput.value.trim());
    }
});

function sendMessage() {
    const message = chatInput.value.trim();
    if (message && currentRoom) {
        socket.emit('chatMessage', { room: currentRoom, message, user: username });
        chatInput.value = '';
    }
}
sendChatBtn.addEventListener('click', sendMessage);
let typingTimeout;
chatInput.addEventListener('input', () => {
    if (currentRoom) {
        socket.emit('typing', { room: currentRoom, user: username });
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('stopTyping', { room: currentRoom, user: username });
        }, 1500);
    }
});

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
        socket.emit('stopTyping', { room: currentRoom, user: username });
    }
});

const typingIndicator = document.getElementById('typingIndicator');
socket.on('typing', (data) => {
    if (data.user !== username) {
        typingIndicator.textContent = `${data.user} is typing...`;
        typingIndicator.classList.remove('hidden');
    }
});
socket.on('stopTyping', (data) => {
    if (data.user !== username) {
        typingIndicator.classList.add('hidden');
    }
});

// Floating Reactions
document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const emoji = btn.getAttribute('data-emoji');
        if (currentRoom) {
            socket.emit('reaction', { room: currentRoom, emoji });
        }
    });
});

socket.on('reaction', (data) => {
    const wrapper = document.querySelector('.video-wrapper');
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    
    if (data.emoji.includes('/emojis/')) {
        const img = document.createElement('img');
        img.src = data.emoji;
        img.style.width = '40px';
        img.style.height = '40px';
        img.style.background = 'white';
        img.style.borderRadius = '50%';
        img.style.boxShadow = '0 0 0 2px white';
        el.appendChild(img);
    } else {
        el.textContent = data.emoji;
    }

    el.style.left = (10 + Math.random() * 80) + '%';
    wrapper.appendChild(el);
    setTimeout(() => el.remove(), 2500);
});

socket.on('chatMessage', (data) => {
    appendMessage(data.user, data.message);
});
function appendMessage(sender, text) {
    const div = document.createElement('div');
    div.className = 'chat-message';
    
    // Check if the text is a direct link to an image or gif
    const isImage = text.match(/\.(jpeg|jpg|gif|png|webp)$/i) != null && text.startsWith('http');
    
    let contentHtml = '';
    if (isImage) {
        contentHtml = `<img src="/proxy?url=${encodeURIComponent(text)}" style="max-width: 100%; border-radius: 8px; margin-top: 8px; display: block;">`;
    } else {
        // Escape HTML to prevent XSS, but allow normal text
        let safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        
        // Parse [e:ID] tags into chat emoji images
        safeText = safeText.replace(/\[e:(\d+)\]/g, '<img src="/emojis/$1.gif" class="chat-emoji" alt="emoji">');
        
        contentHtml = `<div>${safeText}</div>`;
    }

    div.innerHTML = `<div class="sender">${sender}</div>${contentHtml}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

const qualitySelect = document.getElementById('qualitySelect');

// --- LiveKit Integration (Screen Share & Audio) ---
let livekitRoom = null;
let screenTrack = null;
let viewerAudioEl = null;
let LIVEKIT_URL = '';

async function getLivekitToken(room, username) {
    try {
        const response = await fetch(`/api/livekit-token?room=${encodeURIComponent(room)}&username=${encodeURIComponent(username)}`);
        const data = await response.json();
        if (data.url) LIVEKIT_URL = data.url;
        return data.token;
    } catch (err) {
        console.error('Failed to get token:', err);
        return null;
    }
}

async function connectLiveKit() {
    if (livekitRoom) return;
    if (!currentRoom || !username) return;

    try {
        const token = await getLivekitToken(currentRoom, username);
        const { Room, RoomEvent } = LivekitClient;

        livekitRoom = new Room({
            adaptiveStream: true,
            dynacast: true,
            autoSubscribe: true,
            reconnectPolicy: {
                maxRetries: 10,
                retryDelayInMs: 2000,
                nextRetryDelayInMs: (context) => Math.min(context.retryCount * 2000, 10000),
            },
        });

        let audioBlocked = false;

        function showUnmutePrompt() {
            if (document.getElementById('unmute-prompt')) return;
            const prompt = document.createElement('div');
            prompt.id = 'unmute-prompt';
            prompt.style.cssText = `
                position: fixed; top: 72px; left: 50%; transform: translateX(-50%);
                background: var(--accent, #38bdf8); color: #000; padding: 10px 22px;
                border-radius: 8px; font-weight: 700; cursor: pointer; z-index: 10000;
                box-shadow: 0 4px 20px rgba(0,0,0,0.6); font-size: 0.88rem;
                display: flex; align-items: center; gap: 8px;
            `;
            prompt.textContent = '🔊 Click anywhere to unmute live audio (点击开启声音)';
            prompt.onclick = async () => {
                await unlockAudio();
                prompt.remove();
            };
            document.body.appendChild(prompt);
        }

        async function unlockAudio() {
            if (livekitRoom) {
                try {
                    await livekitRoom.startAudio();
                } catch (e) {}
            }
            if (viewerAudioEl && viewerAudioEl.paused) {
                viewerAudioEl.play().catch(() => {});
            }
            const prompt = document.getElementById('unmute-prompt');
            if (prompt) prompt.remove();
        }

        window.addEventListener('click', unlockAudio, { passive: true });
        window.addEventListener('touchstart', unlockAudio, { passive: true });
        window.addEventListener('keydown', unlockAudio, { passive: true });

        function attachTrack(track, participant) {
            const banner = document.getElementById('musicModeBanner') || document.getElementById('djModeBanner');

            if (track.kind === 'video') {
                const old = document.getElementById('lk-viewer');
                if (old) old.remove();

                // Video is active: guarantee Music Mode banner is hidden
                if (banner) banner.classList.add('hidden');

                video.pause();
                video.removeAttribute('src');
                video.innerHTML = '';
                video.load();

                // Prevent mobile and browser WebRTC pipeline from throttling frames for nonexistent video audio
                video.muted = true;
                video.playsInline = true;
                video.setAttribute('playsinline', 'true');
                video.setAttribute('webkit-playsinline', 'true');

                if (track.mediaStreamTrack) {
                    try {
                        track.mediaStreamTrack.contentHint = 'motion';
                    } catch (e) {}
                }

                track.attach(video);
                video.play().catch(() => {});
                
                document.querySelector('.video-wrapper').classList.add('is-live');

                const displayName = participant.identity.split('_')[0];
                appendMessage('System', `${displayName} is sharing their screen.`);
            } else if (track.kind === 'audio') {
                if (viewerAudioEl) { viewerAudioEl.pause(); viewerAudioEl.remove(); }
                // Use LiveKit's official track.attach() for native WebRTC audio pipeline
                viewerAudioEl = track.attach();
                viewerAudioEl.id = 'lk-audio-el';
                viewerAudioEl.style.display = 'none';
                if (player) {
                    viewerAudioEl.volume = player.volume;
                    viewerAudioEl.muted = player.muted;
                }
                document.body.appendChild(viewerAudioEl);

                // Check if this audio belongs strictly to Music Mode (never show banner for screen share audio)
                const isMusicTrack = track.name === 'party-music-audio' || track.name === 'dj-music-audio';
                const hasVideoPublished = Array.from(participant.videoTrackPublications?.values() || []).some(p => p.track || p.isSubscribed);
                const isVideoLive = document.querySelector('.video-wrapper')?.classList.contains('is-live') || 
                                    (video.srcObject && video.srcObject.getVideoTracks && video.srcObject.getVideoTracks().length > 0);

                if (banner) {
                    if (isMusicTrack && !hasVideoPublished && !isVideoLive) {
                        banner.classList.remove('hidden');
                        const sub = document.getElementById('musicBannerSub') || document.getElementById('djBannerSub');
                        if (sub) {
                            const displayName = participant.identity.split('_')[0];
                            sub.textContent = `Music audio live (Broadcaster: ${displayName})`;
                        }
                    } else {
                        banner.classList.add('hidden');
                    }
                }

                viewerAudioEl.play().catch(() => {
                    showUnmutePrompt();
                });
            }
        }

        function detachAll() {
            const banner = document.getElementById('musicModeBanner') || document.getElementById('djModeBanner');
            if (banner) banner.classList.add('hidden');
            const old = document.getElementById('lk-viewer');
            if (old) old.remove();
            const prompt = document.getElementById('unmute-prompt');
            if (prompt) prompt.remove();
            if (viewerAudioEl) { viewerAudioEl.pause(); viewerAudioEl.remove(); viewerAudioEl = null; }
            video.pause();
            video.srcObject = null;
            document.querySelector('.video-wrapper').classList.remove('is-live');
        }

        function syncParticipantTracks(participant) {
            participant.trackPublications.forEach((publication) => {
                if (publication.track) {
                    attachTrack(publication.track, participant);
                } else {
                    publication.setSubscribed(true);
                }
            });
        }

        livekitRoom.on(RoomEvent.ParticipantConnected, (participant) => {
            const displayName = participant.identity.split('_')[0];
            appendMessage('System', `${displayName} joined the room.`);
            syncParticipantTracks(participant);
        });

        livekitRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
            const displayName = participant.identity.split('_')[0];
            appendMessage('System', `${displayName} left the room.`);
        });

        livekitRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            attachTrack(track, participant);
        });

        // Force-subscribe to all published tracks (audio + video)
        livekitRoom.on(RoomEvent.TrackPublished, (publication, participant) => {
            publication.setSubscribed(true);
        });

        livekitRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
            if (track.kind === 'audio' && viewerAudioEl) {
                viewerAudioEl.pause();
                viewerAudioEl.remove();
                viewerAudioEl = null;
                const banner = document.getElementById('musicModeBanner') || document.getElementById('djModeBanner');
                if (banner && (!video.srcObject || !video.srcObject.getVideoTracks || !video.srcObject.getVideoTracks().length)) {
                    banner.classList.add('hidden');
                }
            } else if (track.kind === 'video') {
                video.pause();
                video.srcObject = null;
                document.querySelector('.video-wrapper').classList.remove('is-live');
            }
            appendMessage('System', `${track.kind === 'video' ? 'Screen share' : 'Music audio'} ended.`);
        });

        livekitRoom.on(RoomEvent.AudioPlaybackStatusChanged, () => {
            if (livekitRoom.canPlaybackAudio) {
                const prompt = document.getElementById('unmute-prompt');
                if (prompt) prompt.remove();
            } else {
                showUnmutePrompt();
            }
        });

        livekitRoom.on(RoomEvent.Reconnecting, () => {
            appendMessage('System', 'LiveKit reconnecting...');
        });

        livekitRoom.on(RoomEvent.Reconnected, () => {
            appendMessage('System', 'LiveKit reconnected.');
        });

        livekitRoom.on(RoomEvent.Disconnected, (reason) => {
            console.warn('LiveKit disconnected:', reason);
            livekitRoom = null;
            if (reason !== 'CLIENT_INITIATED') {
                setTimeout(connectLiveKit, 3000);
            }
        });

        await livekitRoom.connect(LIVEKIT_URL, token);
        console.log('LiveKit connected:', livekitRoom.name);

        // Handle already-publishing participants (viewer joined late)
        livekitRoom.remoteParticipants.forEach((participant) => {
            syncParticipantTracks(participant);
        });

    } catch (err) {
        console.error('LiveKit connect error:', err);
        livekitRoom = null;
        appendMessage('System', `LiveKit error: ${err.message}`);
    }
}

shareScreenBtn.addEventListener('click', async () => {
    if (shareScreenBtn.classList.contains('sharing')) {
        await stopScreenShare();
        return;
    }

    // Loading state while browser picker opens + LiveKit connects
    const btnSpan = shareScreenBtn.querySelector('.btn-content');
    btnSpan.textContent = 'Starting...';
    shareScreenBtn.disabled = true;

    try {
        await connectLiveKit();
        if (!livekitRoom) {
            btnSpan.textContent = 'Share 共享屏幕';
            shareScreenBtn.disabled = false;
            return;
        }

        function getQualitySettings(quality) {
            switch (quality) {
                case '1080p60':
                    return {
                        resolution: { width: 1920, height: 1080, frameRate: 60 },
                        maxBitrate: 4_500_000,
                        maxFramerate: 60
                    };
                case '1080p30':
                    return {
                        resolution: { width: 1920, height: 1080, frameRate: 30 },
                        maxBitrate: 3_200_000,
                        maxFramerate: 30
                    };
                case '720p60':
                    return {
                        resolution: { width: 1280, height: 720, frameRate: 60 },
                        maxBitrate: 3_000_000,
                        maxFramerate: 60
                    };
                case '480p30':
                    return {
                        resolution: { width: 854, height: 480, frameRate: 30 },
                        maxBitrate: 800_000,
                        maxFramerate: 30
                    };
                case '720p30':
                default:
                    return {
                        resolution: { width: 1280, height: 720, frameRate: 30 },
                        maxBitrate: 2_000_000,
                        maxFramerate: 30
                    };
            }
        }

        const settings = getQualitySettings(qualitySelect ? qualitySelect.value : '720p30');
        const { createLocalScreenTracks } = LivekitClient;

        const tracks = await createLocalScreenTracks({
            audio: true,
            resolution: settings.resolution
        });

        const publishedTracks = [];
        for (const track of tracks) {
            if (track.kind === 'video') {
                if (track.mediaStreamTrack) {
                    try {
                        // Prioritize fluid motion & steady frame rate over static text sharpness
                        track.mediaStreamTrack.contentHint = 'motion';
                    } catch (e) {}
                }
            }

            // Real quality control: well-tuned bitrate to prevent bufferbloat & packet loss
            // VP8 provides universal hardware/software decoding across all mobile & desktop hardware
            const opts = track.kind === 'video' ? {
                videoEncoding: {
                    maxBitrate: settings.maxBitrate,
                    maxFramerate: settings.maxFramerate
                },
                videoCodec: 'vp8',
                simulcast: false,
                degradationPreference: 'maintain-framerate'
            } : {};

            await livekitRoom.localParticipant.publishTrack(track, opts);
            publishedTracks.push(track);

            if (track.kind === 'video') {
                screenTrack = track;
                try {
                    const pub = livekitRoom.localParticipant.getTrackPublication(track.source);
                    const sender = pub?.track?.sender;
                    if (sender && sender.getParameters) {
                        const params = sender.getParameters();
                        params.degradationPreference = 'maintain-framerate';
                        await sender.setParameters(params);
                    }
                } catch (e) {}

                // Local preview — pipe directly into video element
                const banner = document.getElementById('musicModeBanner') || document.getElementById('djModeBanner');
                if (banner) banner.classList.add('hidden');
                document.querySelector('.video-wrapper')?.classList.add('is-live');

                video.pause();
                video.removeAttribute('src');
                video.innerHTML = '';
                video.load();
                track.attach(video);
                video.play().catch(() => {});
                track.on('ended', stopScreenShare);
            }
        }

        // Store all published tracks so stopScreenShare can unpublish all of them
        shareScreenBtn._publishedTracks = publishedTracks;

        shareScreenBtn.classList.add('sharing');
        shareScreenBtn.querySelector('.btn-content').textContent = 'Stop Sharing';
        shareScreenBtn.disabled = false;

    } catch (err) {
        console.error('Screen share error:', err);
        shareScreenBtn.querySelector('.btn-content').textContent = 'Share 共享屏幕';
        shareScreenBtn.disabled = false;
        appendMessage('System', 'Could not start screen share. Please allow screen capture.');
    }
});

// Live quality switching on the fly without having to restart screen share
if (qualitySelect) {
    qualitySelect.addEventListener('change', async () => {
        if (!shareScreenBtn.classList.contains('sharing') || !screenTrack) return;
        const val = qualitySelect.value;
        const targetBitrate = val === '1080p60' ? 4_500_000
                            : val === '1080p30' ? 3_200_000
                            : val === '720p60'  ? 3_000_000
                            : val === '480p30'  ? 800_000
                            :                     2_000_000;
        const targetFramerate = (val === '1080p60' || val === '720p60') ? 60 : 30;

        try {
            const pub = livekitRoom?.localParticipant?.getTrackPublication(screenTrack.source);
            const sender = pub?.track?.sender;
            if (sender && sender.getParameters) {
                const params = sender.getParameters();
                if (params.encodings && params.encodings.length > 0) {
                    params.encodings[0].maxBitrate = targetBitrate;
                    params.encodings[0].maxFramerate = targetFramerate;
                    await sender.setParameters(params);
                    appendMessage('System', `Live screen quality updated to ${val}.`);
                }
            }
        } catch (e) {
            console.warn('Could not update live encoding:', e);
        }
    });
}


// --- Music Mode (Audio-Only WebRTC Streaming) ---
const musicModeBtn = document.getElementById('musicModeBtn') || document.getElementById('djModeBtn');
const musicModeBanner = document.getElementById('musicModeBanner') || document.getElementById('djModeBanner');
const musicBannerSub = document.getElementById('musicBannerSub') || document.getElementById('djBannerSub');
let musicAudioTrack = null;

// Backward-compatibility aliases
const djModeBtn = musicModeBtn;
const djModeBanner = musicModeBanner;
const djBannerSub = musicBannerSub;
let djAudioTrack = null;

if (musicModeBtn) {
    musicModeBtn.addEventListener('click', async () => {
        if (musicModeBtn.classList.contains('broadcasting')) {
            await stopMusicMode();
            return;
        }

        const btnSpan = musicModeBtn.querySelector('.btn-content');
        btnSpan.textContent = 'Starting...';
        musicModeBtn.disabled = true;

        try {
            await connectLiveKit();
            if (!livekitRoom) {
                btnSpan.textContent = 'Music Mode 音乐模式';
                musicModeBtn.disabled = false;
                return;
            }

            const { createLocalScreenTracks } = LivekitClient;
            // Capture raw, uncompressed 48kHz stereo tab audio without speech DSP filters
            const tracks = await createLocalScreenTracks({
                audio: {
                    autoGainControl: false,
                    echoCancellation: false,
                    noiseSuppression: false,
                    channelCount: 2,
                    sampleRate: 48000,
                    suppressLocalAudioPlayback: false
                },
                video: true
            });

            let audioTrack = null;
            for (const track of tracks) {
                if (track.kind === 'video') {
                    track.stop(); // Stop video immediately, no video stream published!
                } else if (track.kind === 'audio') {
                    audioTrack = track;
                }
            }

            if (!audioTrack) {
                alert('No audio track selected! Please make sure to check "Share tab audio" or "Also share system audio" in the browser prompt.');
                btnSpan.textContent = 'Music Mode 音乐模式';
                musicModeBtn.disabled = false;
                return;
            }

            // Publish high-fidelity studio stereo at 160 kbps Opus
            await livekitRoom.localParticipant.publishTrack(audioTrack, {
                name: 'party-music-audio',
                source: LivekitClient.Track.Source.ScreenShareAudio,
                audioPreset: LivekitClient.AudioPresets.musicHighQualityStereo,
                audioBitrate: 160000,
                forceStereo: true,
                dtx: false,
                red: true
            });
            musicAudioTrack = audioTrack;
            djAudioTrack = audioTrack;

            musicModeBtn.classList.add('broadcasting');
            btnSpan.textContent = 'Stop Music 停止音乐';
            musicModeBtn.disabled = false;

            if (musicModeBanner) {
                musicModeBanner.classList.remove('hidden');
                musicBannerSub.textContent = 'Broadcasting pure audio to room';
            }

            audioTrack.on('ended', stopMusicMode);
            appendMessage('System', 'Music Mode active: streaming tab audio to room.');
        } catch (err) {
            console.error('Music Mode error:', err);
            musicModeBtn.querySelector('.btn-content').textContent = 'Music Mode 音乐模式';
            musicModeBtn.disabled = false;
            appendMessage('System', 'Could not start Music audio: ' + err.message);
        }
    });
}

async function stopMusicMode() {
    if (musicAudioTrack) {
        try {
            await livekitRoom?.localParticipant.unpublishTrack(musicAudioTrack);
            musicAudioTrack.stop();
        } catch (e) {}
        musicAudioTrack = null;
        djAudioTrack = null;
    }

    if (musicModeBtn) {
        musicModeBtn.classList.remove('broadcasting');
        musicModeBtn.querySelector('.btn-content').textContent = 'Music Mode 音乐模式';
    }

    if (musicModeBanner) {
        musicModeBanner.classList.add('hidden');
    }

    appendMessage('System', 'Music Mode ended.');
}
const stopDJMode = stopMusicMode;

async function stopScreenShare() {
    const tracks = shareScreenBtn._publishedTracks || [];
    for (const track of tracks) {
        try {
            if (track.kind === 'video') {
                try { track.detach(video); } catch (e) {}
            }
            await livekitRoom?.localParticipant.unpublishTrack(track);
            track.stop();
        } catch (e) { /* already stopped */ }
    }
    shareScreenBtn._publishedTracks = [];
    screenTrack = null;

    video.pause();
    video.srcObject = null;
    video.removeAttribute('src');
    video.load(); // This forces the browser to show the offline.jpg poster again
    
    document.querySelector('.video-wrapper')?.classList.remove('is-live');
    const banner = document.getElementById('musicModeBanner') || document.getElementById('djModeBanner');
    if (banner) {
        if (musicAudioTrack) {
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }
    }

    shareScreenBtn.classList.remove('sharing');
    shareScreenBtn.querySelector('.btn-content').textContent = 'Share 共享屏幕';
}









// --- Soundboard Logic ---
const sounds = {
    'vine-boom': 'https://www.myinstants.com/media/sounds/vine-boom.mp3',
    'bruh': 'https://www.myinstants.com/media/sounds/movie_1.mp3',
    'applause': 'https://www.myinstants.com/media/sounds/applause.mp3'
};

document.querySelectorAll('.soundboard-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const sound = btn.getAttribute('data-sound');
        if (currentRoom) {
            socket.emit('soundboard', { room: currentRoom, sound, user: username });
            playSound(sound); // play locally immediately
        }
    });
});

socket.on('soundboard', (data) => {
    if (data.user !== username) {
        playSound(data.sound);
        appendMessage('System', `${data.user} played ${data.sound}`);
    }
});

function playSound(soundKey) {
    if (sounds[soundKey]) {
        const audio = new Audio(sounds[soundKey]);
        audio.volume = 0.5;
        audio.play().catch(e => console.log('Soundplay prevented', e));
    }
}

// WeChat Emoji Picker Initialization
const wechatEmojiGrid = document.getElementById('wechatEmojiGrid');
const emojiPickerPanel = document.getElementById('emojiPickerPanel');
const expandEmojisBtn = document.getElementById('expandEmojisBtn');

// Add emojis 0 to 99
if (wechatEmojiGrid) {
    for (let i = 0; i <= 99; i++) {
        const img = document.createElement('img');
        img.src = '/emojis/' + i + '.gif';
        img.alt = 'emoji ' + i;
        img.loading = 'lazy'; // Improve performance
        img.addEventListener('click', () => {
            if (currentRoom) {
                socket.emit('reaction', { room: currentRoom, emoji: img.src });
                // Optional: send multiple, or close after sending
                // emojiPickerPanel.classList.add('hidden');
            }
        });
        wechatEmojiGrid.appendChild(img);
    }
}

if (expandEmojisBtn) {
    expandEmojisBtn.addEventListener('click', () => {
        emojiPickerPanel.classList.toggle('hidden');
    });
}

// Chat Emoji Picker Initialization
const chatEmojiGrid = document.getElementById('chatEmojiGrid');
const chatEmojiPanel = document.getElementById('chatEmojiPanel');
const toggleChatEmojisBtn = document.getElementById('toggleChatEmojisBtn');
const chatInputRef = document.getElementById('chatInput');

if (chatEmojiGrid) {
    for (let i = 0; i <= 99; i++) {
        const img = document.createElement('img');
        img.src = '/emojis/' + i + '.gif';
        img.alt = 'emoji ' + i;
        img.loading = 'lazy';
        img.addEventListener('click', () => {
            chatInputRef.value += '[e:' + i + ']';
            chatEmojiPanel.classList.add('hidden');
            chatInputRef.focus();
        });
        chatEmojiGrid.appendChild(img);
    }
}

if (toggleChatEmojisBtn) {
    toggleChatEmojisBtn.addEventListener('click', () => {
        chatEmojiPanel.classList.toggle('hidden');
    });
}


