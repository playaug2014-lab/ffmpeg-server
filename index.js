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
  const { videoUrl, audioUrl, duration, title } = req.query;
  const maxDuration = parseInt(duration) || 60;

  // ✅ clean title — remove ALL special chars that break FFmpeg
  const safeTitle = (title || 'Watch Now')
    .replace(/['"\\:]/g, '')   // remove quotes, backslash, colon
    .replace(/\s+/g, ' ')      // normalize spaces
    .trim()
    .substring(0, 40);         // max 40 chars

  const videoPath = '/tmp/input.mp4';
  const audioPath = '/tmp/audio.mp3';
  const outputPath = '/tmp/output.mp4';

  try {
    console.log('Downloading video...');
    await downloadFile(videoUrl, videoPath);
    console.log('Video downloaded!');

    console.log('Downloading audio...');
    await downloadFile(audioUrl, audioPath);
    console.log('Audio downloaded!');

    console.log('Max duration:', maxDuration);
    console.log('Safe title:', safeTitle);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .inputOptions([
          '-stream_loop', '-1',
          '-t', maxDuration.toString()
        ])
        .input(audioPath)
        .inputOptions(['-stream_loop', '-1'])
        .complexFilter([
          // ✅ title text at top
          {
            filter: 'drawtext',
            options: {
              text: safeTitle,
              fontsize: 32,
              fontcolor: 'white',
              x: '(w-text_w)/2',
              y: '30',
              box: 1,
              boxcolor: 'black@0.6',
              boxborderw: 8,
            },
            inputs: '0:v',
            outputs: 'titled'
          },
          // ✅ subscribe text at bottom
          {
            filter: 'drawtext',
            options: {
              text: 'SUBSCRIBE for more',
              fontsize: 24,
              fontcolor: 'yellow',
              x: '(w-text_w)/2',
              y: 'h-60',
              box: 1,
              boxcolor: 'black@0.6',
              boxborderw: 6,
            },
            inputs: 'titled',
            outputs: 'final'
          }
        ])
        .outputOptions([
          '-map [final]',        // ✅ video from complexFilter
          '-map 1:a:0',          // ✅ audio from second input
          '-c:v libx264',
          '-c:a aac',
          '-preset ultrafast',
          '-crf 28',
          '-threads 1',
          '-ar 44100',
          '-ac 2',
          '-b:a 192k',
          '-t', maxDuration.toString()
        ])
        .output(outputPath)
        .on('start', (cmd) => console.log('FFmpeg started:', cmd))
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
    [videoPath, audioPath, outputPath].forEach(f => {
      try { fs.unlinkSync(f); } catch (_) {}
    });
  }
});

app.get('/', (req, res) => res.send('FFmpeg server running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));