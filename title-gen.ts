#!/usr/bin/env tsx
import { Command } from 'commander';
import { execSync } from 'child_process';
import * as fs from 'fs';

interface TitleGenOptions {
  duration: string;
  imagePath: string;
  width: string;
  height: string;
  title: string;
  ending: string;
}

const program = new Command();

program.name('title-gen')
  .description('Generate title and ending videos from an image')
  .requiredOption('-i, --imagePath <path>', 'Path to input image file')
  .option('-d, --duration <number>', 'Duration of each video in seconds', '5')
  .option('--width <number>', 'Video width in pixels', '1920')
  .option('--height <number>', 'Video height in pixels', '1080')
  .option('--title <filename>', 'Title video file name', 'title.mp4')
  .option('--ending <filename>', 'Ending (black screen) file name', 'ending.mp4');

program.parse(process.argv);

const { duration, width, height, imagePath, title, ending } = program.opts<TitleGenOptions>();

const resolution = `${parseInt(width, 10)}x${parseInt(height, 10)}`;

let titleFile = title.endsWith('.mp4') ? title : `${title}.mp4`;
let endingFile = ending.endsWith('.mp4') ? ending : `${ending}.mp4`;

const fps = 30;

// Validate image file
if (!fs.existsSync(imagePath)) {
  console.error(`❌ Image not found: ${imagePath}`);
  process.exit(1);
}

// Add .mp4 if missing
if (!titleFile.endsWith('.mp4')) titleFile += '.mp4';
if (!endingFile.endsWith('.mp4')) endingFile += '.mp4';

// 1. Generate title video (from image)
const titleCmd = `ffmpeg -loop 1 -i "${imagePath}" -c:v libx264 -t ${duration} -vf "scale=${resolution},format=yuv420p,fps=${fps}" -pix_fmt yuv420p -r ${fps} -y "${titleFile}"`;
console.log(`🎞️ Generating title video: ${titleFile}`);
execSync(titleCmd, { stdio: 'inherit' });

// 2. Generate ending video (black screen)
const endingCmd = `ffmpeg -f lavfi -i color=black:s=${resolution}:d=${duration} -c:v libx264 -vf "fps=${fps},format=yuv420p" -pix_fmt yuv420p -r ${fps} -y "${endingFile}"`;
console.log(`🎬 Generating ending video: ${endingFile}`);
execSync(endingCmd, { stdio: 'inherit' });

console.log(`✅ Done! Created: ${titleFile} and ${endingFile}`);
