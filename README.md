# Immich Slideshow Toolkit

Three command-line tools to create **slideshow videos** from **[Immich](https://immich.app) albums**.

<img src="https://raw.githubusercontent.com/immich-app/immich/refs/heads/main/design/immich-logo-inline-light.svg" width="200px">

---

## 📦 Scripts Overview

1. **`immich-video-gen.ts`**  
   Fetches an album from Immich (or uses a local folder of images) and generates a slideshow video with zoom & crossfade transitions.  
   Supports optional *title* and *ending* video segments.

2. **`audio-config-gen.ts`**  
   Generates a JSON configuration describing how multiple MP3 files should be arranged (start/end times, fades) for a full-length background audio track.

3. **`video-and-audio-merge.ts`**  
   Merges a video with multiple audio files according to the JSON configuration, applying fades and synchronizing timing.

---

## 🔧 Installation

```bash
# Install dependencies
npm install
```

## 🐳 Running in Docker

If you prefer not to install Node.js, TypeScript, and FFmpeg locally, you can run the scripts inside Docker.

### 1. Build the Docker image
```bash
docker build -t immich-slideshow .
```

### 2. Run a script
Example: generating a slideshow from Immich  
```bash
docker run --rm \
  -v $(pwd)/output:/app/output \
  immich-slideshow \
  ./immich-video-gen.ts \
    --url http://immich-server:2283/api \
    --album ALBUM_ID \
    --token YOUR_API_KEY \
    --outputDir ./output
```

### ⚠️ Notes: ###
- Do not use `localhost` in the `url` when running Docker, as this will not point to the host, but to your container.
- `-v $(pwd)/output:/app/output` mounts your local `output` folder into the container so files are saved outside Docker.
- If using a local folder of images instead of Immich, mount it too: `-v $(pwd)/photos:/app/photos`
---

## 1️⃣ Generating a Slideshow Video

### Usage with photos from Immich Album

```bash
./immich-video-gen.ts \
  --url http://localhost:2283/api \
  --album ALBUM_ID \
  --token YOUR_API_KEY
```

### Usage with photos from local folder

```bash
./immich-video-gen.ts \
  --inputDir ./photos
```

### Key Options
| Option | Description | Default |
|--------|-------------|---------|
| `--url` | Immich API base URL | *required if fetching from Immich* |
| `--album` | Album ID | *required if fetching from Immich* |
| `--token` | Immich API key| *required if fetching from Immich* |
| `--inputDir` | Local folder with images | *required if using images from local folder* |
| `--outputDir` | Directory for temp files | `./output` |
| `--video` | Output video path | `./output/output_video-only.mp4` |
| `--photoDuration` | Seconds each photo stays visible | `5` |
| `--fadeDuration` | Crossfade duration in seconds | `1` |
| `--width`  | Output video width | `1920` |
| `--height` | Output video height | `1080` |
| `--title` | Optional intro video | -- |
| `--ending` | Optional outro video | -- |

---

## 2️⃣ Generating an Audio Config

Creates a JSON file describing how MP3 tracks will be played in sequence, including start/end times and fade durations.

### Usage with a folder of MP3s
```bash
./audio-config-gen.ts \
  --audio-dir ./audio/ \
  --output ./audio-config.json
```

### Usage with an XSPF playlist
```bash
./audio-config-gen.ts \
  --xspf-file ./playlist.xspf \
  --output ./audio-config.json
```

### JSON Structure Example
```json
[
  {
    "file": "/path/to/audio1.mp3",
    "start": 0,
    "end": 120,
    "fileStart": 0,
    "fadeIn": 2,
    "fadeOut": 3
  },
  {
    "file": "/path/to/audio2.mp3",
    "start": 120,
    "end": 240,
    "fileStart": 0,
    "fadeIn": 2,
    "fadeOut": 3
  }
]
```

---

## 3️⃣ Merging Video & Audio

Takes the slideshow video and the audio config JSON and merges them into a single MP4 file.

### Usage
```bash
./video-and-audio-merge.ts \
  --videoFile ./output/slideshow.mp4 \
  --configFile ./audio-config.json
```

The script will:
- Validate that all audio files exist and durations match the config.
- Warn about gaps or overlaps between tracks.
- Apply fades in/out.
- Mix audio tracks with silence to fill gaps.
- Output a synchronized MP4 with video and combined audio.

---

## ⚠️ Notes
- These scripts require **FFmpeg** and **FFprobe**.
- Large albums are processed in batches to avoid FFmpeg command limits.
- Title and ending videos are simply concatenated — no fades there for performance reasons.
- Audio merging uses a silent base track to avoid missing audio in gaps.

---

## 🛠 Example Workflow

```bash
# 1. Fetch Immich album and make slideshow
./immich-video-gen.ts --url ... --album ... --token ... --video ./output/slideshow.mp4

# 2. Generate audio configuration
./audio-config-gen.ts --audio-dir ./audio --fade-in 2 --fade-out 3 --output ./audio-config.json

# 3. Merge slideshow and audio
./video-and-audio-merge.ts --videoFile ./output/slideshow.mp4 --configFile ./audio-config.json --outputFile ./output/final.mp4
```

---

## 🔑 Getting Album ID & API Token from Immich

To use `immich-video-gen.ts` with Immich, you’ll need your **Album ID** and an **API token**.

### 1. Get the Album ID
1. Open the Immich web app in your browser.
2. Navigate to the album you want to use.
3. Look at the URL in your browser — it will look like this:  
   ```
   https://your-immich-server/albums/5b7f9c8e-bc1a-4f33-babc-123456789abc
   ```
4. The part after `/albums/` is the **Album ID**:  
   ```
   5b7f9c8e-bc1a-4f33-babc-123456789abc
   ```

### 2. Get an API Token
1. In the Immich web app, click your profile icon in the top right.
2. Go to **Settings** → **API Keys**.
3. Click **+ Generate API Key**.
4. Give it a name (e.g., `slideshow-script`) and click **Generate**.
5. Copy the token — it will look like:  
   ```
   eyJhbGciOiJIUzI1NiIsInR512345kpXVCJ...
   ```
   ⚠️ **Save this token somewhere safe** — you’ll need to pass it to the script via `--token`.