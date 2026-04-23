const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const multer = require('multer');

ffmpeg.setFfmpegPath(ffmpegPath);
const app = express();
const upload = multer({ dest: '/tmp/' });

app.post('/render', upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'audio', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('Files:', JSON.stringify(req.files));
    const imagePath = req.files['image'][0].path;
    const audioPath = req.files['audio'][0].path;
    const outputPath = '/tmp/output.mp4';

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