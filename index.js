const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');

ffmpeg.setFfmpegPath(ffmpegPath);
const app = express();
app.use(express.json({ limit: '10mb' }));

async function downloadFile(url, destPath) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    maxRedirects: 15,
    timeout: 120000,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Cookie': 'download_warning=t',
    },
  });
  fs.writeFileSync(destPath, Buffer.from(res.data));
}

// ✅ Check if a video file has an audio stream
function hasAudioStream(filePath) {
  try {
    const out = execSync(
      `ffprobe -v quiet -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 ${filePath}`
    ).toString();
    return out.includes('audio');
  } catch (_) { return false; }
}

// ✅ Normalize clip — if no audio, inject silent track so concat never crashes
async function normalizeClip(inputPath, outputPath) {
  const needsSilence = !hasAudioStream(inputPath);
  if (needsSilence) {
    console.log(`  ⚠️  No audio in clip — adding silent track`);
  }
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg().input(inputPath);
    if (needsSilence) {
      // Add silent audio source so the clip has an audio stream
      cmd.input('anullsrc=r=44100:cl=stereo').inputOptions(['-f', 'lavfi']);
    }
    cmd.outputOptions([
      '-vf', 'scale=1280:720,fps=30',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      '-threads', '1',
      '-c:a', 'aac',      // ✅ keeps original audio (or silence if none)
      '-b:a', '192k',
      '-shortest'
    ])
    .output(outputPath)
    .on('end', resolve)
    .on('error', reject)
    .run();
  });
}

// Delete raw clip immediately after normalizing to free memory
async function downloadAndNormalize(url, index) {
  const rawPath = `/tmp/video_${index}.mp4`;
  const normPath = `/tmp/norm_${index}.mp4`;

  console.log(`Downloading clip ${index + 1}...`);
  await downloadFile(url, rawPath);
  console.log(`Clip ${index + 1} downloaded!`);

  console.log(`Normalizing clip ${index + 1}...`);
  await normalizeClip(rawPath, normPath);

  // Delete raw file RIGHT AWAY to free memory
  try { fs.unlinkSync(rawPath); } catch (_) {}
  console.log(`Clip ${index + 1} normalized!`);

  return normPath;
}

app.get('/render', async (req, res) => {
  const { videoUrls, duration } = req.query;   // ✅ audioUrl removed — not needed
  const maxDuration = parseInt(duration) || 60;
  const urlList = (videoUrls || '').split('|').filter(Boolean);
  const outputPath = '/tmp/output.mp4';
  const concatPath = '/tmp/concat.txt';
  const normalizedPaths = [];

  try {
    // Download + normalize + delete raw, one at a time
    for (let i = 0; i < urlList.length; i++) {
      const normPath = await downloadAndNormalize(urlList[i], i);
      normalizedPaths.push(normPath);
    }

    // Build concat file
    const timesNeeded = Math.ceil(maxDuration / (normalizedPaths.length * 20));
    let concatContent = '';
    for (let t = 0; t < timesNeeded; t++) {
      for (const nPath of normalizedPaths) {
        concatContent += `file '${nPath}'\n`;
      }
    }
    fs.writeFileSync(concatPath, concatContent);
    console.log('Max duration:', maxDuration);
    console.log('Clips:', normalizedPaths.length);
    console.log('Loop times:', timesNeeded);

    // Final concat — no external audio, use clips' own audio
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions([
          '-map 0:v:0',
          '-map 0:a:0',    // ✅ audio from clips (guaranteed to exist after normalizeClip)
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-ar', '44100',
          '-ac', '2',
          '-b:a', '192k',
          '-t', maxDuration.toString()
        ])
        .output(outputPath)
        .on('start', () => console.log('FFmpeg started'))
        .on('end', () => { console.log('FFmpeg done!'); resolve(); })
        .on('error', (err) => { console.error('FFmpeg error:', err.message); reject(err); })
        .run();
    });

    const video = fs.readFileSync(outputPath);
    res.set('Content-Type', 'video/mp4');
    res.send(video);

  } catch (err) {
    console.error('ERROR:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    // ✅ audioPath removed from cleanup
    [...normalizedPaths, outputPath, concatPath].forEach(f => {
      try { fs.unlinkSync(f); } catch (_) {}
    });
  }
});

app.get('/', (req, res) => res.send('FFmpeg server running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));