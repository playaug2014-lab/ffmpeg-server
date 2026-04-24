const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const axios = require('axios');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);
const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/render', async (req, res) => {
  const { videoUrl, audioUrl, duration } = req.query;
  const maxDuration = parseInt(duration) || 60;
  const videoPath = '/tmp/input.mp4';
  const audioPath = '/tmp/audio.mp3';
  const outputPath = '/tmp/output.mp4';

  try {
    console.log('Downloading video:', videoUrl);
    const videoRes = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      maxRedirects: 10,
      timeout: 120000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    fs.writeFileSync(videoPath, Buffer.from(videoRes.data));
    console.log('Video downloaded!');

    console.log('Downloading audio:', audioUrl);
    const audioRes = await axios.get(audioUrl, {
      responseType: 'arraybuffer',
      maxRedirects: 15,
      timeout: 120000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Cookie': 'download_warning=t',
      },
    });
    fs.writeFileSync(audioPath, Buffer.from(audioRes.data));
    console.log('Audio downloaded!');

    console.log('Max duration:', maxDuration);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .inputOptions([
          '-stream_loop', '-1',         // ✅ loop video infinitely
          '-t', maxDuration.toString()  // ✅ limit loop to duration
        ])
        .input(audioPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-map 0:v:0',
          '-map 1:a:0',
          '-preset ultrafast',
          '-crf 28',
          '-threads 1'
          // ✅ no -shortest
          // ✅ no -t here
        ])
        .duration(maxDuration)          // ✅ safety net
        .output(outputPath)
        .on('start', cmd => console.log('FFmpeg cmd:', cmd))
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
  }
});

app.get('/', (req, res) => res.send('FFmpeg server running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));