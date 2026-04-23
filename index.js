const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);
const app = express();
app.use(express.json({ limit: '100mb' }));

app.post('/render', async (req, res) => {
  const { imageBase64, audioBase64 } = req.body;
  const imagePath = '/tmp/input.jpg';
  const audioPath = '/tmp/audio.mp3';
  const outputPath = '/tmp/output.mp4';

  try {
    fs.writeFileSync(imagePath, Buffer.from(imageBase64, 'base64'));
    fs.writeFileSync(audioPath, Buffer.from(audioBase64, 'base64'));
    console.log('Files written OK');

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(imagePath)
        .loop()
        .input(audioPath)
        .audioCodec('aac')
        .videoCodec('libx264')
        .size('1920x1080')
        .outputOptions(['-pix_fmt yuv420p', '-shortest'])
        .output(outputPath)
        .on('end', () => { console.log('FFmpeg done!'); resolve(); })
        .on('error', (err) => { console.error('FFmpeg error:', err.message); reject(err); })
        .run();
    });

    const video = fs.readFileSync(outputPath);
    res.set('Content-Type', 'video/mp4');
    res.send(video);

  } catch (err) {
    console.error('FAILED:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.send('FFmpeg server running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));