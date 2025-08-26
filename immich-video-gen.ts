#!/usr/bin/env tsx
import axios from "axios";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { Command } from "commander";
import type { OptionValues } from "commander";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { spawn } from 'child_process';
import { exec as execCb } from 'child_process';
import { promisify } from "util";

const exec = promisify(execCb);
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

interface AlbumAsset {
  id: string;
  type: string;
}

interface AlbumResponse {
  order: string;
  assets: AlbumAsset[];
}

interface FfmpegImmichOptions extends OptionValues {
  url: string,
  album: string,
  token: string,
  inputDir: string,
  outputDir: string,
  video: string,
  photoDuration: string,
  fadeDuration: string,
  title: string,
  ending: string,
  photoConfig: string
}

async function createSlideshowAsync(
  imageDir: string,
  outputFile: string,
  imgDuration = 5.0,
  fadeDuration = 1.0,
  width = 1920,
  height = 1080,
  fps = 30,
  title: string,
  ending: string): Promise<void> {

  const supportedExtensions = ['.jpg', '.jpeg', '.png'];
  const images = fs
    // Read all files in the directory
    .readdirSync(imageDir)
    // Filter for supported image formats
    .filter(file => supportedExtensions.includes(path.extname(file).toLowerCase()))
    // Sort files numerically
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    // Map to full paths
    .map(file => path.join(imageDir, file));

  const numImages = images.length;
  console.log(`Found ${numImages} images in the directory.`);

  if (numImages < 2) {
    throw new Error('❌ Need at least 2 images to create a slideshow with transitions.');
  }

  // run in batches of 50 images
  const batchVideoFiles: string[] = [];

  const batchSize = 100;

  for (let i = 0; i < numImages; i += batchSize) {
    const batchImages = images.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.ceil(i / batchSize) + 1} of ${Math.ceil(numImages / batchSize)}...`);

    const batchOutputFile = path.join(path.dirname(outputFile), `batch_${Math.ceil(i / batchSize) + 1}.mp4`);

    await createPartialVideoAsync(batchImages, batchOutputFile, imgDuration, fadeDuration, width, height, fps);

    batchVideoFiles.push(batchOutputFile);
    console.log(`Batch video created: ${batchOutputFile}`);
  }

  // // Combine all batch videos into one final video with a similar fade effect
  // await mergeAllWithCrossfade(
  //   batchVideoFiles,
  //   outputFile,
  //   fadeDuration,
  //   fps,
  //   width,
  //   height
  // );

  // If title video is provided, prepend it
  if (title) batchVideoFiles.unshift(title);

  // If ending video is provided, append it
  if (ending) batchVideoFiles.push(ending);

  if (batchVideoFiles.length === 1) {
    // If there's only one video, just rename it to the final output
    fs.renameSync(batchVideoFiles[0], outputFile);
  }
  else {
    // // Concat all batch videos into one final video without any effect
    await mergeAllPlainConcatAsync(
      batchVideoFiles,
      outputFile,
    );
  }
}


async function createPartialVideoAsync(images: string[], outputFile: string, imgDuration: number, fadeDuration: number, width: number, height: number, fps: number): Promise<void> {
  const numImages = images.length;
  const inputs = images
    .map(image => ["-loop", "1", "-t", `${imgDuration}`, "-i", `${image}`]);

  // Create filter graph for zoom and crossfade
  // Each image will be zoomed in slightly and crossfaded with the next one
  // The zoompan filter is used to create a zoom effect
  // The xfade filter is used to create a crossfade effect
  let filter = '';
  images.forEach((_, i) => {
    filter += `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='zoom+0.001':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${imgDuration * fps}:fps=${fps},setsar=1[v${i}];`;
    // filter += `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='zoom+0.001':d=${imgDuration * fps}:fps=${fps},setsar=1[v${i}];`;
  });

  for (let i = 0; i < numImages - 1; i++) {
    const offset = (imgDuration - fadeDuration) * (i + 1);
    if (i === 0) {
      filter += `[v0][v1]xfade=transition=fade:duration=${fadeDuration}:offset=${offset}[xf0];`;
    } else {
      filter += `[xf${i - 1}][v${i + 1}]xfade=transition=fade:duration=${fadeDuration}:offset=${offset}[xf${i}];`;
    }
  }

  const totalDuration = (imgDuration - fadeDuration) * numImages + fadeDuration;

  const lastOutput = `[xf${numImages - 2}]`;

  const args = [
    ...inputs.flat(), // input array flattened
    '-filter_complex', `\"${filter}\"`, // Use double quotes to encapsulate the filter graph
    '-map', lastOutput, // Use the last output from the filter graph
    '-c:v', 'libx264', // Use H.264 codec for video
    '-r', `${fps}`, // Set frame rate
    '-pix_fmt', 'yuv420p', // Set pixel format to yuv420p for compatibility
    '-t', `${totalDuration}`, // Set the total duration of the video
    '-shortest', // Ensure the output is not longer than the total duration
    '-y', // Overwrite output file if it exists
    '-threads', '6',
    outputFile,
  ];

  let cmdline = `ffmpeg ${args.join(' ')}`;

  console.log('⚙️  Running FFmpeg...');
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(cmdline, { shell: true });

    ffmpeg.stdout.on('data', data => {
      process.stdout.write(data.toString());
    });

    ffmpeg.stderr.on('data', data => {
      process.stderr.write(data.toString());
    });

    ffmpeg.on('error', err => {
    });

    ffmpeg.on('close', code => {
      if (code === 0) {
        console.log(`✅ Slideshow created: ${outputFile} (Duration: ${totalDuration}s)`);
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
  });
}

// Function to download an image
async function downloadImageAsync(apiUrl: string, id: string, outputPath: string, token: string): Promise<void> {

  const url = `${apiUrl}/assets/${id}/original`;
  console.log("url ", url);
  const writer = fs.createWriteStream(outputPath);
  const response = await axios.get(url,
    {
      responseType: "stream",
      headers: {
        "x-api-key": `${token}`
      }
    });
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
};

async function fetchPhotosAsync(apiUrl: string,
  token: string,
  outputDir: string,
  photoIdList: string[],
): Promise<number> {
  for (const [index, photoId] of photoIdList.entries()) {
    const outputPath = path.join(outputDir, `photo_${index + 1}.jpg`);
    await downloadImageAsync(apiUrl, photoId, outputPath, token);
  }

  return photoIdList.length;
};

// Function to fetch album images from Immich
async function fetchAlbumAsync(
  apiUrl: string,
  albumId: string,
  token: string,
  outputDir: string
): Promise<number> {
  const albumResponse = await axios.get<AlbumResponse>(`${apiUrl}/albums/${albumId}`, {
    headers: { "x-api-key": `${token}` },
  });


  if (!albumResponse.data.assets || albumResponse.data.assets.length === 0) {
    throw new Error("No assets found in the album.");
  }

  let assets = albumResponse.data.assets.filter(asset => asset.type === "IMAGE");
  console.log(`Found ${assets.length} photos in the album.`);

  if (albumResponse.data.order === "asc") {
    assets = assets.reverse();
  }

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`Downloading ${assets.length} images to ${outputDir}...`);

  // Download images
  for (const [index, asset] of assets.entries()) {
    const outputPath = path.join(outputDir, `image_${index + 1}.jpg`);
    await downloadImageAsync(apiUrl, asset.id, outputPath, token);
    console.log(`Downloaded ${index + 1} of ${assets.length}: ${outputPath}`);
  }

  return assets.length;
};

async function getVideoDurationAsync(file: string): Promise<number> {
  const { stdout } = await exec(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`
  );
  return parseFloat(stdout.trim());
}

async function mergeTwoVideosCrossfadeAsync(
  video1: string,
  video2: string,
  output: string,
  fadeDuration: number,
  fps: number,
  width: number,
  height: number
): Promise<void> {
  const dur1 = await getVideoDurationAsync(video1);
  const offset = dur1 - fadeDuration;

  const args = [
    '-i', video1,
    '-i', video2,
    '-filter_complex', `[0:v][1:v]xfade=transition=fade:duration=${fadeDuration}:offset=${offset.toFixed(2)}[v]`,
    '-map', '[v]',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', `${fps}`,
    '-s', `${width}x${height}`,
    '-y', output
  ];

  console.log(`➡️ Merging ${path.basename(video1)} + ${path.basename(video2)} → ${path.basename(output)}`);

  const ffmpeg = spawn('ffmpeg', args, { shell: true });

  return new Promise((resolve, reject) => {
    ffmpeg.stdout.on('data', data => {
      process.stdout.write(data.toString());
    });

    ffmpeg.stderr.on('data', data => {
      process.stderr.write(data.toString());
    });

    ffmpeg.on('error', err => {
    });

    ffmpeg.on('close', code => {
      if (code === 0) {
        console.log(`✅ Merged video saved as: ${output}`);
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
  });
}

async function mergeAllWithCrossfade(
  outputDir: string,
  videoFiles: string[],
  finalOutput: string,
  fadeDuration: number,
  fps: number,
  width: number,
  height: number
): Promise<void> {
  if (videoFiles.length < 2) {
    throw new Error('Need at least two videos to merge.');
  }

  let currentOutput = videoFiles[0]; // Start with the first video
  let tempCounter = 0;

  for (let i = 1; i < videoFiles.length; i++) {
    const nextInput = videoFiles[i];
    const nextOutput = path.join(outputDir, `merge_${tempCounter++}.mp4`);

    await mergeTwoVideosCrossfadeAsync(currentOutput, nextInput, nextOutput, fadeDuration, fps, width, height);

    // Delete the previous file only if it was a temp file (not original input)
    if (currentOutput !== videoFiles[0]) {
      try {
        fs.unlinkSync(currentOutput);
      } catch (_) { }
    }

    currentOutput = nextOutput;
  }

  // Move the final result to the desired output file
  fs.renameSync(currentOutput, finalOutput);
  console.log(`✅ Final merged video saved as: ${finalOutput}`);
}

async function cleanUpFilesAsync(outputDir: string, inputDir?: string) {
  // cleanup batch video files
  const batchVideoFiles = fs.readdirSync(outputDir)
    .filter(file => file.startsWith('batch_') && file.endsWith('.mp4'))
    .map(file => path.join(outputDir, file));
  for (const batchFile of batchVideoFiles) {
    try {
      await fs.promises.unlink(batchFile);
      console.log(`Deleted temporary batch file: ${batchFile}`);
    } catch (err) {
      console.error(`Error deleting temporary batch file ${batchFile}: ${(err as Error).message}`);
    }
  }
  // cleanup images

  if (inputDir) {
    console.log(`Skipping cleanup of images in input directory: ${inputDir}`);
    const imageFiles = (await fs.promises.readdir(outputDir))
      .filter(file => file.startsWith('image_') && (file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')))
      .map(file => path.join(outputDir, file));

    for (const imageFile of imageFiles) {
      try {
        fs.promises.unlink(imageFile);
        console.log(`Deleted temporary image file: ${imageFile}`);
      } catch (err) {
        console.error(`Error deleting temporary image file ${imageFile}: ${(err as Error).message}`);
      }
    }
  }
}

async function mergeAllPlainConcatAsync(videoFiles: string[], outputFile: string): Promise<void> {
  if (videoFiles.length < 2) {
    throw new Error('At least two video files are required to merge.');
  }

  // Create a concat list file in output directory
  const outputDir = path.dirname(outputFile);
  const listFile = path.join(outputDir, `concat_list_${Date.now()}.txt`);

  // strip of outputDir from videoFiles
  videoFiles = videoFiles.map(file => path.relative(outputDir, file));

  const listContent = videoFiles.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.promises.writeFile(listFile, listContent);

  const args = [
    '-f', 'concat',
    '-safe', '0',
    '-i', listFile,
    '-c', 'copy',
    '-y',
    outputFile,
  ];

  console.log(`🚀 Merging ${videoFiles.length} videos into: ${outputFile}`);

  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, { shell: true });

    ffmpeg.on('error', reject);

    ffmpeg.stdout.on('data', data => {
      process.stdout.write(data.toString());
    });

    ffmpeg.stderr.on('data', data => {
      process.stderr.write(data.toString());
    });

    ffmpeg.on('close', code => {
      fs.unlinkSync(listFile); // Clean up temp list file
      if (code === 0) {
        console.log(`✅ Merged video saved to: ${outputFile}`);
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
  });
}

(async () => {
  // CLI setup using Commander
  const program = new Command();

  program
    .name("immich-video-gen")
    .description("Fetch an Immich album and create a video")
    .option('--photoConfig <file>', 'JSON file with ordered photo list')
    .option("-u, --url <url>", "Immich API base URL")
    .option("-a, --album <id>", "Album ID")
    .option("-t, --token <token>", "Authentication token")
    .option("-o, --outputDir <path>", "Output directory", "./output")
    .option("-i, --inputDir <path>", "Input directory")
    .option("--photoDuration <secs>", "Photo duration", "5")
    .option("--fadeDuration <secs>", "Fade duration", "1")
    .option("-v, --video <path>", "Output video file", "./output/output_video-only.mp4")
    .option("--width <width>", "Video width", "1920")
    .option("--height <height>", "Video height", "1080")
    .option("--title <path>", "Optional title video to prepend")
    .option("--ending <path>", "Optional ending video to append");

  program.parse(process.argv);
  const options = program.opts<FfmpegImmichOptions>();

  // either url, album, token are required or inputDir
  if ((!options.url || !options.album || !options.token) && !options.inputDir && (!options.url || !options.photoConfig || !options.token)) {
    if (options.photoConfig && (!options.url || !options.token))
      // If photoConfig is provided, ensure url and token are also present
      console.error("❌ Missing required options: --url, --token");
    else if (!options.url || !options.album || !options.token)
      // else ensure url, album, and token are also present
      console.error("❌ Missing required options: --url, --album, --token");
    else if (!options.inputDir)
      // else inputDir needs to be provided
      console.error("❌ Missing required option: --inputDir");
    program.help();
    process.exit(1);
  }

  if (options.title) {
    if (!fs.existsSync(options.title)) {
      console.error(`❌ Title video not found at: ${options.title}`);
      process.exit(1);
    } else {
      console.log(`✅ Found title video: ${options.title}`);
    }
  }

  if (options.ending) {
    if (!fs.existsSync(options.ending)) {
      console.error(`❌ Ending video not found at: ${options.ending}`);
      process.exit(1);
    } else {
      console.log(`✅ Found ending video: ${options.ending}`);
    }
  }

  if (options.photoConfig) {
    if (!fs.existsSync(options.photoConfig)) {
      console.error(`❌ Photo config does not exist: ${options.photoConfig}`);
      process.exit(1);
    }

    if (options.inputDir) {
      console.error("❌ Input directory cannot be combined with photo config");
      process.exit(1);
    }

    if (options.album) {
      console.error("❌ Album ID cannot be combined with photo config");
      process.exit(1);
    }
  }


  try {
    // If inputDir is provided, use it directly
    if (options.inputDir) {
      console.log(`Using input directory: ${options.inputDir}`);
      if (!fs.existsSync(options.inputDir)) {
        throw new Error(`Input directory does not exist: ${options.inputDir}`);
      }
    }
    else if (options.photoConfig) {
      console.log(`Using photo config: ${options.photoConfig}`);

      const photoConfigContent = await fs.promises.readFile(options.photoConfig, 'utf-8');
      const photoConfig = JSON.parse(photoConfigContent);
      if (!Array.isArray(photoConfig) || photoConfig.length === 0) {
        console.error(`Invalid photo config: ${options.photoConfig}`);
        process.exit(1);
      }

      const photoIdList = photoConfig.map((photo: { id: string; }) => photo.id) as string[];

      await fetchPhotosAsync(options.url, options.token, options.outputDir, photoIdList);
    } else {
      console.log("Fetching album...");
      await fetchAlbumAsync(
        options.url,
        options.album,
        options.token,
        options.outputDir
      );
    }

    console.log("Creating video...");

    await createSlideshowAsync(
      options.outputDir,
      options.video,
      parseFloat(options.photoDuration),
      parseFloat(options.fadeDuration),
      parseInt(options.width),
      parseInt(options.height),
      30,
      options.title,
      options.ending);

    console.log(`Video created successfully at ${options.video}`);

    await cleanUpFilesAsync(options.outputDir);

  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
  }
})();