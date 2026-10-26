const yts = require('yt-search');
const fs = require('fs');
// Load local .env if present
try {
    if (fs.existsSync('.env')) {
        const lines = fs.readFileSync('.env', 'utf8').split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx > 0) {
                    const k = trimmed.substring(0, eqIdx).trim();
                    const v = trimmed.substring(eqIdx + 1).trim();
                    if (!process.env[k]) process.env[k] = v;
                }
            }
        }
    }
} catch (e) {}

const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const url = require('url');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

app.use(express.static(path.join(__dirname, 'public')));

// Admin Dashboard Routes
app.use(express.json());

if (!LIVEKIT_URL) throw new Error('CRITICAL: LIVEKIT_URL environment variable is missing!');
const httpUrl = LIVEKIT_URL.replace('wss://', 'https://').replace('ws://', 'http://');
const roomService = new RoomServiceClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
// Admin routes stay locked unless ADMIN_PASSWORD is set
const ADMIN_PASS = process.env.ADMIN_PASSWORD;

app.get('/api/admin/rooms', async (req, res) => {
    if (!ADMIN_PASS || req.query.pass !== ADMIN_PASS) return res.status(401).json({error: 'unauthorized'});
    try {
        const rooms = await roomService.listRooms();
        res.json(rooms);
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

app.post('/api/admin/kill', async (req, res) => {
    if (!ADMIN_PASS || req.body.pass !== ADMIN_PASS) return res.status(401).json({error: 'unauthorized'});
    try {
        await roomService.deleteRoom(req.body.room);
        res.json({success: true});
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});


// LiveKit Token Endpoint
app.get('/api/livekit-token', async (req, res) => {
    const { room, username } = req.query;
    if (!room || !username) return res.status(400).json({ error: 'room and username required' });
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        return res.status(500).json({ error: 'LiveKit API keys not configured on server.' });
    }

    // Add random suffix to allow multiple tabs/windows for the same user without kicking each other
    const livekitIdentity = `${username}_${Math.random().toString(36).substr(2, 6)}`;
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: livekitIdentity,
        ttl: '6h',
    });
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });

    const token = await at.toJwt();
    res.json({ token, url: LIVEKIT_URL });
});

// Simple room state memory
const roomState = {};

// Helper to fetch JSON
const fetchJson = (urlStr) => {
    return new Promise((resolve, reject) => {
        https.get(urlStr, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
};

const INVIDIOUS_INSTANCES = [
    'https://invidious.jing.rocks',
    'https://vid.puffyan.us',
    'https://inv.tux.pizza',
    'https://invidious.nerdvpn.de',
    'https://invidious.namazso.eu'
];

// Video Proxy Route
app.get('/proxy', async (req, res) => {
    let videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('URL is required');

    try {
        // Detect YouTube URL
        const ytMatch = videoUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
        
        if (ytMatch && ytMatch[1]) {
            const videoId = ytMatch[1];
            console.log('Detected YouTube Video ID:', videoId);
            
            let metadata = null;
            // Try multiple instances until one works
            for (const instance of INVIDIOUS_INSTANCES) {
                const apiUrl = `${instance}/api/v1/videos/${videoId}`;
                console.log(`Trying Invidious API: ${apiUrl}`);
                try {
                    metadata = await fetchJson(apiUrl);
                    if (metadata && metadata.formatStreams && metadata.formatStreams.length > 0) {
                        break; // Success
                    }
                } catch (e) {
                    console.log(`Instance ${instance} failed. Trying next...`);
                }
            }
            
            if (metadata && metadata.formatStreams && metadata.formatStreams.length > 0) {
                // Get the best format
                const bestStream = metadata.formatStreams.sort((a, b) => b.bitrate - a.bitrate)[0];
                videoUrl = bestStream.url;
                console.log('Successfully extracted raw MP4 URL');
            } else {
                throw new Error('All Invidious instances failed or blocked.');
            }
        } else {
            console.log('Proxying direct URL:', videoUrl);
        }

        // Now proxy the raw videoUrl (either the direct link or the extracted MP4 link)
        const parsedUrl = new url.URL(videoUrl);
        const requestModule = parsedUrl.protocol === 'https:' ? https : http;

        const proxyReq = requestModule.request(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                ...req.headers,
                host: parsedUrl.host
            }
        }, (proxyRes) => {
            // Forward headers
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            // Pipe the media chunk by chunk
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
            console.error('Proxy stream error:', err);
            if (!res.headersSent) res.status(500).send('Failed to proxy video');
        });

        proxyReq.end();
    } catch (err) {
        console.error('Proxy Error:', err.message);
        if (!res.headersSent) res.status(400).send('Failed to process URL');
    }
});

// --- GIF Proxy (Bypasses Great Firewall and removes API Key requirement) ---
app.get('/api/gifs', (req, res) => {
    const query = req.query.q || 'trending';
    const url = `https://tenor.com/search/${encodeURIComponent(query).replace(/%20/g, '-')}-gifs`;

    https.get(url, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
            try {
                // Extract tenor GIF URLs from the HTML
                const matches = Array.from(data.matchAll(/src="(https:\/\/media\.tenor\.com\/[^"]+\.gif)"/g));
                const urls = [...new Set(matches.map(m => m[1]))].slice(0, 12);
                res.json({ urls });
            } catch (err) {
                console.error("Error parsing Tenor HTML:", err);
                res.json({ urls: [] });
            }
        });
    }).on('error', (err) => {
        console.error("Error fetching Tenor HTML:", err);
        res.json({ urls: [] });
    });
});


// YouTube Song Search Endpoint (Proxied for clients in restricted regions)
app.get('/api/search-songs', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    try {
        const searchResult = await yts(q);
        const videos = (searchResult.videos || []).slice(0, 8).map(v => ({
            title: v.title,
            videoId: v.videoId,
            url: v.url,
            timestamp: v.timestamp,
            author: v.author ? v.author.name : 'Unknown',
            thumbnail: v.thumbnail
        }));
        res.json(videos);
    } catch (err) {
        console.error('yt-search error:', err);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Track participants per room: room -> { socketId: username }
const roomParticipants = {};
const roomJukebox = {};
const lastPlayNextTimestamp = {};

io.on('connection', (socket) => {
    let currentRoom = null;
    let currentUser = null;

    socket.on('joinRoom', ({ room, username }) => {
        // Support legacy string-only joinRoom calls
        if (typeof room === 'string' && typeof username === 'undefined') {
            username = 'Anonymous';
        }

        currentRoom = room;
        currentUser = username || 'Anonymous';

        socket.join(room);

        // Track participant
        if (!roomParticipants[room]) roomParticipants[room] = {};
        roomParticipants[room][socket.id] = currentUser;

        // Send current state to new joiner (includes videoUrl)
        if (roomState[room]) {
            socket.emit('syncState', roomState[room]);
        }

        // Send jukebox state to new joiner
        if (roomJukebox[room]) {
            socket.emit('jukeboxUpdate', roomJukebox[room]);
        }

        // Broadcast updated participant list to whole room
        const participants = Object.values(roomParticipants[room]);
        io.to(room).emit('participantUpdate', participants);
    });

    // Video Sync Events
    socket.on('play', ({ room, time }) => {
        if (!roomState[room]) roomState[room] = {};
        Object.assign(roomState[room], { playing: true, time, lastUpdate: Date.now() });
        socket.to(room).emit('play', time);
    });
    socket.on('pause', ({ room, time }) => {
        if (!roomState[room]) roomState[room] = {};
        Object.assign(roomState[room], { playing: false, time, lastUpdate: Date.now() });
        socket.to(room).emit('pause', time);
    });
    socket.on('seek', ({ room, time }) => {
        if (roomState[room]) {
            roomState[room].time = time;
            roomState[room].lastUpdate = Date.now();
        }
        socket.to(room).emit('seek', time);
    });

    // Video URL sync — when host loads a new video, everyone gets it
    socket.on('videoUrlChange', ({ room, url }) => {
        if (!roomState[room]) roomState[room] = {};
        roomState[room].videoUrl = url;
        roomState[room].time = 0;
        roomState[room].playing = false;
        socket.to(room).emit('videoUrlChange', url);
    });

    // Chat Events
    socket.on('chatMessage', ({ room, message, user }) => {
        io.to(room).emit('chatMessage', { message, user });
    });

    socket.on('typing', ({ room, user }) => {
        socket.to(room).emit('typing', { user });
    });

    socket.on('stopTyping', ({ room, user }) => {
        socket.to(room).emit('stopTyping', { user });
    });

    socket.on('reaction', ({ room, emoji }) => {
        io.to(room).emit('reaction', { emoji });
    });

    socket.on('soundboard', ({ room, sound, user }) => {
        io.to(room).emit('soundboard', { sound, user });
    });

    
    // Jukebox / DJ Mode Events
    socket.on('jukeboxGet', ({ room }) => {
        if (!roomJukebox[room]) {
            roomJukebox[room] = { currentDJ: null, nowPlaying: null, queue: [] };
        }
        socket.emit('jukeboxUpdate', roomJukebox[room]);
    });

    socket.on('jukeboxAdd', ({ room, song, user }) => {
        if (!roomJukebox[room]) {
            roomJukebox[room] = { currentDJ: user, nowPlaying: null, queue: [] };
        }
        const item = { ...song, user, id: Date.now() + Math.random().toString(36).substr(2, 4) };
        if (!roomJukebox[room].nowPlaying) {
            roomJukebox[room].nowPlaying = item;
        } else {
            roomJukebox[room].queue.push(item);
        }
        io.to(room).emit('jukeboxUpdate', roomJukebox[room]);
    });

    socket.on('jukeboxRemove', ({ room, id }) => {
        if (roomJukebox[room]) {
            roomJukebox[room].queue = roomJukebox[room].queue.filter(s => s.id !== id);
            io.to(room).emit('jukeboxUpdate', roomJukebox[room]);
        }
    });

    socket.on('jukeboxPlayNext', ({ room }) => {
        if (!room || !roomJukebox[room]) return;
        const now = Date.now();
        if (lastPlayNextTimestamp[room] && (now - lastPlayNextTimestamp[room] < 2000)) {
            // Debounce rapid duplicate skip requests within 2 seconds
            return;
        }
        lastPlayNextTimestamp[room] = now;

        if (roomJukebox[room].queue.length > 0) {
            if (roomJukebox[room].nowPlaying) {
                if (!roomJukebox[room].history) roomJukebox[room].history = [];
                roomJukebox[room].history.unshift(roomJukebox[room].nowPlaying);
                if (roomJukebox[room].history.length > 10) roomJukebox[room].history.pop();
            }
            roomJukebox[room].nowPlaying = roomJukebox[room].queue.shift();
        } else {
            if (roomJukebox[room].nowPlaying) {
                if (!roomJukebox[room].history) roomJukebox[room].history = [];
                roomJukebox[room].history.unshift(roomJukebox[room].nowPlaying);
                if (roomJukebox[room].history.length > 10) roomJukebox[room].history.pop();
            }
            roomJukebox[room].nowPlaying = null;
        }
        io.to(room).emit('jukeboxUpdate', roomJukebox[room]);
    });

    socket.on('jukeboxReplaySong', ({ room, song, user }) => {
        if (!roomJukebox[room]) {
            roomJukebox[room] = { currentDJ: user, nowPlaying: null, queue: [], history: [] };
        }
        const item = { ...song, user, id: Date.now() + Math.random().toString(36).substr(2, 4) };
        roomJukebox[room].queue.push(item);
        io.to(room).emit('jukeboxUpdate', roomJukebox[room]);
    });

    socket.on('jukeboxSetDJ', ({ room, user }) => {
        if (!roomJukebox[room]) {
            roomJukebox[room] = { currentDJ: user, nowPlaying: null, queue: [] };
        } else {
            roomJukebox[room].currentDJ = user;
        }
        io.to(room).emit('jukeboxUpdate', roomJukebox[room]);
    });

    socket.on('gameAction', ({ room, game, type, payload, user }) => {
        io.to(room).emit('gameAction', { game, type, payload, user, senderId: socket.id });
    });

    socket.on('disconnect', () => {
        if (currentRoom && roomParticipants[currentRoom]) {
            delete roomParticipants[currentRoom][socket.id];
            const participants = Object.values(roomParticipants[currentRoom]);
            io.to(currentRoom).emit('participantUpdate', participants);
            if (participants.length === 0) {
                delete roomParticipants[currentRoom];
                delete roomState[currentRoom];
                delete roomJukebox[currentRoom];
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});


