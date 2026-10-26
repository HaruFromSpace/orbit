# orbit

A web app for watching videos in sync with a friend. I built it to watch movies with a friend who lives in another country.

It's most useful when a site like YouTube is restricted where the other person lives. One person plays the video and shares their screen, and everyone in the room watches together.

Everyone in a room sees the same play, pause and seek. Next to the video there's a chat with GIFs, voice and video calls, screen sharing, a shared music queue, and two small games (tic-tac-toe and a shared doodle board).

## How it works

- Node.js and Express serve the app.
- Socket.io keeps playback, chat and the music queue in sync.
- [LiveKit](https://livekit.io) handles voice, video and screen sharing over WebRTC. The server only hands out short-lived access tokens.
- The frontend is plain HTML, CSS and JavaScript, no framework.

## Run it locally

You need Node.js 18 or newer and a free LiveKit Cloud project.

```bash
git clone https://github.com/HaruFromSpace/orbit
cd orbit
npm install
cp .env.example .env   # then fill in your LiveKit keys
npm start
```

Open http://localhost:3000, pick a room name and share it with a friend.

## Deploying

It runs on Render's free tier as a Node web service. Set the variables from `.env.example` in the Render dashboard; never commit a real `.env`.

## License

MIT
