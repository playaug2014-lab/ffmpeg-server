const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const axios = require('axios');
const fs = require('fs');
const multer = require('multer');

ffmpeg.setFfmpegPath(ffmpegPath);
const app = express();
const upload = multer({ dest: '/tmp/' });

app.post('/render', upload.single('image'), async (req, res) => {
  const imagePath = req.file.path;
  const audioUrl = req.body.audioUrl;
  const audioPath = '/tmp/audio.mp3';
  const outputPath = '/tmp/output.mp4';

  try {
    console.log('Downloading audio from:', audioUrl);
    const audioRes = await axios.get(audioUrl, {
      responseType: 'arraybuffer',
      maxRedirects: 10,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    fs.writeFileSync(audioPath, Buffer.from(audioRes.data));
    console.log('Audio downloaded, running FFmpeg...');

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
        .on('end', resolve)
        .on('error', reject)
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