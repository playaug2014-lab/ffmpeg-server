const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const axios = require('axios');
const fs = require('fs');

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

async function normalizeClip(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputPath)
      .outputOptions([
        '-vf', 'scale=1280:720,fps=30',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '28',
        '-threads', '1',       // ✅ FIX 1: limit threads
        '-an'
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// ✅ FIX 2: delete raw clip immediately after normalizing
async function downloadAndNormalize(url, index) {
  const rawPath = `/tmp/video_${index}.mp4`;
  const normPath = `/tmp/norm_${index}.mp4`;

  console.log(`Downloading clip ${index + 1}...`);
  await downloadFile(url, rawPath);
  console.log(`Clip ${index + 1} downloaded!`);

  console.log(`Normalizing clip ${index + 1}...`);
  await normalizeClip(rawPath, normPath);

  // ✅ Delete raw file RIGHT AWAY to free memory
  try { fs.unlinkSync(rawPath); } catch (_) {}
  console.log(`Clip ${index + 1} normalized!`);

  return normPath;
}

app.get('/render', async (req, res) => {
  const { videoUrls, audioUrl, duration } = req.query;
  const maxDuration = parseInt(duration) || 60;
  const urlList = (videoUrls || '').split('|').filter(Boolean);
  const audioPath = '/tmp/audio.mp3';
  const outputPath = '/tmp/output.mp4';
  const concatPath = '/tmp/concat.txt';
  const normalizedPaths = [];

  try {
    // ✅ FIX 3: download + normalize + delete raw, one at a time
    for (let i = 0; i < urlList.length; i++) {
      const normPath = await downloadAndNormalize(urlList[i], i);
      normalizedPaths.push(normPath);
    }

    // Download audio
    console.log('Downloading audio...');
    await downloadFile(audioUrl, audioPath);
    console.log('Audio downloaded!');

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

    // ✅ FIX 4: final concat uses -c copy (no re-encoding!)
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .input(audioPath)
        .inputOptions(['-stream_loop', '-1'])
        .outputOptions([
          '-map 0:v:0',
          '-map 1:a:0',
          '-c:v', 'copy',        // ✅ no re-encode, just copy stream
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
    [...normalizedPaths, audioPath, outputPath, concatPath].forEach(f => {
      try { fs.unlinkSync(f); } catch (_) {}
    });
  }
});

app.get('/', (req, res) => res.send('FFmpeg server running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));