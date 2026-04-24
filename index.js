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

app.get('/render', async (req, res) => {
  const { videoUrls, audioUrl, duration } = req.query;
  const maxDuration = parseInt(duration) || 60;
  const urlList = (videoUrls || '').split('|').filter(Boolean);
  const audioPath = '/tmp/audio.mp3';
  const outputPath = '/tmp/output.mp4';
  const concatPath = '/tmp/concat.txt';
  const videoPaths = [];

  try {
    // Download all clips
    for (let i = 0; i < urlList.length; i++) {
      const vPath = `/tmp/video_${i}.mp4`;
      console.log(`Downloading clip ${i + 1}/${urlList.length}...`);
      await downloadFile(urlList[i], vPath);
      videoPaths.push(vPath);
      console.log(`Clip ${i + 1} downloaded!`);
    }

    // Download audio
    console.log('Downloading audio...');
    await downloadFile(audioUrl, audioPath);
    console.log('Audio downloaded!');

    // Build concat file
    const timesNeeded = Math.ceil(maxDuration / (urlList.length * 20));
    let concatContent = '';
    for (let t = 0; t < timesNeeded; t++) {
      for (const vPath of videoPaths) {
        concatContent += `file '${vPath}'\n`;
      }
    }
    fs.writeFileSync(concatPath, concatContent);
    console.log('Max duration:', maxDuration);
    console.log('Clips:', urlList.length);
    console.log('Loop times:', timesNeeded);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .input(audioPath)
        .inputOptions(['-stream_loop', '-1'])
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-map 0:v:0',
          '-map 1:a:0',
          '-preset ultrafast',
          '-crf 28',
          '-threads 1',
          '-ar 44100',
          '-ac 2',
          '-b:a 192k',
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
    [...videoPaths, audioPath, outputPath, concatPath].forEach(f => {
      try { fs.unlinkSync(f); } catch (_) {}
    });
  }
});

app.get('/', (req, res) => res.send('FFmpeg server running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));