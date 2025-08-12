#!/usr/bin/env tsx
import { Command } from 'commander';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { DOMParser } from '@xmldom/xmldom';

interface AudioConfig {
  file: string;
  start: number;
  end: number;
  fileStart?: number;
  fadeIn?: number;
  fadeOut?: number;
}

interface AudioConfigOptions {
  audioDir?: string;
  xspfFile?: string;
  fadeIn: string;
  fadeOut: string;
  output: string;
}

interface XSPFEntry {
  title: string | null;
  creator: string | null;
  album: string | null;
  location: string;  // URL or path
}

function parseXSPF(content: string): XSPFEntry[] {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(content, "application/xml");

  const trackElements = Array.from(xmlDoc.getElementsByTagName('track'));
  const entries: XSPFEntry[] = trackElements.map(track => {
    const getText = (tag: string) => {
      const el = track.getElementsByTagName(tag)[0];
      return el ? el.textContent : null;
    };
    return {
      title: getText('title'),
      creator: getText('creator'),
      album: getText('album'),
      location: decodeURIComponent(getText('location')|| ''),
    };
  });

  return entries;
}

function getAudioDuration(filePath: string): number {
  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath
  ];

  const result = spawnSync('ffprobe', args, { encoding: 'utf-8' });
  if (result.status !== 0) {
    console.error(`❌ Failed to get duration of ${filePath}`);
    process.exit(1);
  }
  return parseInt(result.stdout.trim());
}

const program = new Command();

program
  .name('audio-config-gen')
  .description('Generate audio config JSON from a directory of mp3s')
  .option('--audio-dir <path>', 'Directory of .mp3 audio files')
  .option('--xspf-file <path>', 'Path to XSPF file')
  .option('--fade-in <seconds>', 'Fade in duration (default: 0)', '0')
  .option('--fade-out <seconds>', 'Fade out duration (default: 0)', '0')
  .option('--output <path>', 'Output JSON file', 'audio-config.json');

program.parse(process.argv);

const { audioDir, fadeIn, fadeOut, output, xspfFile } = program.opts<AudioConfigOptions>();

let files: string[] = [];

if (audioDir) {
  const dirPath = path.resolve(audioDir);
  if (!fs.existsSync(dirPath)) {
    console.error(`❌ Directory does not exist: ${dirPath}`);
    process.exit(1);
  }

  files = fs.readdirSync(dirPath)
    .filter(f => f.toLowerCase().endsWith('.mp3'))
    .sort();
}
else if (xspfFile) {
  const xspfPath = path.resolve(xspfFile);
  if (!fs.existsSync(xspfPath)) {
    console.error(`❌ XSPF file does not exist: ${xspfPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(xspfPath, 'utf-8');
  const entries = parseXSPF(content);

  files = entries.map(entry => {
    const loc = entry.location.startsWith('file://') ? entry.location.slice(7) : entry.location;
    return path.resolve(loc);
  }).filter(f => f.toLowerCase().endsWith('.mp3'));
}
else {
  console.error('❌ You must specify either --audio-dir or --xspf-file');
  program.help();
  process.exit(1);
}

const fadeInSec = parseFloat(fadeIn || '0');
const fadeOutSec = parseFloat(fadeOut || '0');

let currentStart = 0;
const config: AudioConfig[] = [];

for (const file of files) {
  const duration = getAudioDuration(file);

  config.push({
    file: file,
    start: currentStart,
    end: currentStart + duration,
    fileStart: 0,
    fadeIn: fadeInSec,
    fadeOut: fadeOutSec
  });

  currentStart += duration;
}

fs.writeFileSync(output, JSON.stringify(config, null, 2));
console.log(`✅ Audio config written to: ${output}`);