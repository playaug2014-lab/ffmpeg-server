const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const axios = require('axios');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);
const app = express();
app.use(express.json({ limit: '10mb' }));

app.post('/render', async (req, res) => {
  const { videoUrl, audioUrl } = req.body;
  const videoPath = '/tmp/input.mp4';
  const audioPath = '/tmp/audio.mp3';
  const outputPath = '/tmp/output.mp4';

  try {
    console.log('Downloading video:', videoUrl);
    const videoRes = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      maxRedirects: 10,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    fs.writeFileSync(videoPath, Buffer.from(videoRes.data));
    console.log('Video downloaded!');

    console.log('Downloading audio:', audioUrl);
    const audioRes = await axios.get(audioUrl, {
      responseType: 'arraybuffer',
      maxRedirects: 10,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    fs.writeFileSync(audioPath, Buffer.from(audioRes.data));
    console.log('Audio downloaded!');

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-map 0:v:0',
          '-map 1:a:0',
          '-shortest',
          '-preset ultrafast',
          '-crf 28',
          '-threads 1'
        ])
        .output(outputPath)
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