#!/usr/bin/env tsx
import { Command } from 'commander';
import { type OptionValues } from 'commander';
import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface VideoAndAudioOptions extends OptionValues {
  videoFile: string;
  configFile: string;
  outputFile: string;
}

interface AudioConfig {
  file: string;
  start: number;       // video time start (sec)
  end: number;         // video time end (sec)
  fileStart?: number;  // start within the file (default: 0)
  fadeIn?: number;     // in seconds (0 = no fade)
  fadeOut?: number;    // in seconds (0 = no fade)
}

const program = new Command();

program
  .name('video-and-audio-merge')
  .description('Merge a video with multiple audio files with timing and fades.')
  .requiredOption('-v, --videoFile <path>', 'Input video file (mp4)')
  .requiredOption('-c, --configFile <path>', 'JSON config file for audio tracks')
  .option('-o, --outputFile <path>', 'Output file path', 'output_video-and-audio.mp4');

program.parse(process.argv);

const { videoFile, configFile, outputFile } = program.opts<VideoAndAudioOptions>();

if (!fs.existsSync(videoFile)) {
  console.error(`❌ Video file not found: ${videoFile}`);
  process.exit(1);
}
if (!fs.existsSync(configFile)) {
  console.error(`❌ Config file not found: ${configFile}`);
  process.exit(1);
}

function getMediaDuration(file: string): number {
  try {
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${file}"`,
      { encoding: 'utf-8' }
    ).trim();
    return parseFloat(output);
  } catch {
    console.error(`❌ Failed to get duration for: ${file}`);
    process.exit(1);
  }
}

const videoDuration = getMediaDuration(videoFile);
const audioConfigs: AudioConfig[] = JSON.parse(fs.readFileSync(configFile, 'utf-8'));

// --- Validation Step ---
audioConfigs.forEach((audio, idx) => {
  if (!fs.existsSync(audio.file)) {
    console.error(`❌ Audio file not found: ${audio.file}`);
    process.exit(1);
  }

  const fileStart = audio.fileStart ?? 0;
  const actualAudioDuration = getMediaDuration(audio.file);
  const usableDuration = actualAudioDuration - fileStart;
  const requestedDuration = audio.end - audio.start;

  if (requestedDuration > usableDuration + 0.0001) {
    console.error(
      `❌ Audio track #${idx + 1} (${audio.file}) from ${audio.start}s to ${audio.end}s ` +
      `(${requestedDuration.toFixed(3)}s) exceeds actual file duration ` +
      `(${usableDuration.toFixed(3)}s).`
    );
    process.exit(1);
  }

  if (requestedDuration <= 0) {
    console.error(`❌ Invalid duration: ${audio.file} has end <= start`);
    process.exit(1);
  }
});

// --- Gap & Overlap Check ---
const sortedConfigs = [...audioConfigs].sort((a, b) => a.start - b.start);
for (let i = 0; i < sortedConfigs.length - 1; i++) {
  const gap = sortedConfigs[i + 1].start - sortedConfigs[i].end;
  if (gap > 0.0001) {
    console.warn(
      `⚠️  Gap detected: Between "${sortedConfigs[i].file}" (ends at ${sortedConfigs[i].end}s)` +
      ` and "${sortedConfigs[i + 1].file}" (starts at ${sortedConfigs[i + 1].start}s) — gap of ${gap.toFixed(3)}s`
    );
  }
  if (gap < -0.0001) {
    console.warn(
      `⚠️  Overlap detected: "${sortedConfigs[i].file}" (ends at ${sortedConfigs[i].end}s)` +
      ` overlaps with "${sortedConfigs[i + 1].file}" (starts at ${sortedConfigs[i + 1].start}s) — overlap of ${Math.abs(gap).toFixed(3)}s`
    );
  }
}

const inputs: string[] = [`-i "${videoFile}"`];
const filters: string[] = [];
const finalAudioLabels: string[] = [];

// Process each audio config
audioConfigs.forEach((audio, index) => {
  const inputIndex = index + 1; // after video input
  const fileStart = audio.fileStart ?? 0;
  const duration = audio.end - audio.start;
  const delayMs = Math.round(audio.start * 1000);

  inputs.push(`-i "${audio.file}"`);

  // Step 1: Trim & reset timestamps
  let lastLabel = `atrim${index}`;
  filters.push(
    `[${inputIndex}:a]atrim=start=${fileStart}:duration=${duration},asetpts=PTS-STARTPTS[${lastLabel}]`
  );

  // Step 2: Fade In
  if (audio.fadeIn && audio.fadeIn > 0 && audio.fadeIn < duration) {
    const fadeInLabel = `fadein${index}`;
    filters.push(
      `[${lastLabel}]afade=t=in:st=0:d=${audio.fadeIn}[${fadeInLabel}]`
    );
    lastLabel = fadeInLabel;
  }

  // Step 3: Fade Out
  if (audio.fadeOut && audio.fadeOut > 0 && audio.fadeOut < duration) {
    const fadeOutStart = duration - audio.fadeOut;
    const fadeOutLabel = `fadeout${index}`;
    filters.push(
      `[${lastLabel}]afade=t=out:st=${fadeOutStart}:d=${audio.fadeOut}[${fadeOutLabel}]`
    );
    lastLabel = fadeOutLabel;
  }

  // Step 4: Delay to match video timeline
  filters.push(
    `[${lastLabel}]adelay=${delayMs}|${delayMs}[a${index}]`
  );

  finalAudioLabels.push(`[a${index}]`);
});

// Add silent audio track of video duration to fill gaps
inputs.push(`-f lavfi -t ${videoDuration} -i anullsrc=channel_layout=stereo:sample_rate=44100`);
const silentAudioIndex = audioConfigs.length + 1; // after all inputs
finalAudioLabels.unshift(`[${silentAudioIndex}:a]`);

// Mix all audio inputs including silence
const filterComplex = `${filters.join(';')};${finalAudioLabels.join('')}amix=inputs=${finalAudioLabels.length}:duration=longest[aout]`;

const outputPath = path.resolve(outputFile);
const ffmpegCmd = `ffmpeg ${inputs.join(' ')} -filter_complex "${filterComplex}" -map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "${outputPath}"`;

console.log(`🚀 Merging:
Video: ${videoFile}
Config: ${configFile}
Output: ${outputPath}
`);

console.log('⚙️  Running FFmpeg...');
const ffmpeg = spawn(ffmpegCmd, { shell: true });

ffmpeg.stdout.on('data', data => {
  process.stdout.write(data.toString());
});

ffmpeg.stderr.on('data', data => {
  process.stderr.write(data.toString());
});

ffmpeg.on('error', err => {
  console.error('❌ FFmpeg process error:', err);
});

ffmpeg.on('close', code => {
  if (code === 0) {
    console.log(`✅ Video and audio merged successfully! Output: ${outputPath}`);
  } else {
    console.error(`❌ FFmpeg exited with code ${code}`);
  }
});

