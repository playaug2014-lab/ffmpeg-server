const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const axios = require('axios');
const fs = require('fs');
const multer = require('multer');

ffmpeg.setFfmpegPath(ffmpegPath);
const app = express();
const upload = multer({ dest: '/tmp/', fileFilter: (req, file, cb) => cb(null, true) });

app.post('/render', upload.single('image'), async (req, res) => {
  try {
    const imagePath = req.file.path;
    const audioUrl = req.query.audioUrl;
    const audioPath = '/tmp/audio.mp3';
    const outputPath = '/tmp/output.mp4';

    console.log('Image received:', imagePath);
    console.log('Audio URL:', audioUrl);

    const audioRes = await axios.get(audioUrl, {
      responseType: 'arraybuffer',
      maxRedirects: 10,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    fs.writeFileSync(audioPath, Buffer.from(audioRes.data));
    console.log('Audio downloaded!');

  await new Promise((resolve, reject) => {
  ffmpeg()
    .input(imagePath)
    .loop()
    .input(audioPath)
    .audioCodec('aac')
    .videoCodec('libx264')
    .size('1280x720')
    .outputOptions([
      '-pix_fmt yuv420p',
      '-shortest',
      '-preset ultrafast',
      '-crf 28',
      '-threads 1'
    ])
    .output(outputPath)
    .on('end', () => { console.log('Done!'); resolve(); })
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