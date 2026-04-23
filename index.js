const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const axios = require('axios');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);
const app = express();
app.use(express.json({ limit: '50mb' }));

async function downloadFile(url, destPath) {
  const fileId = url.match(/id=([^&]+)/)?.[1];
  const directUrl = fileId
    ? `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`
    : url;

  console.log('Downloading:', directUrl);
  const response = await axios({
    method: 'GET',
    url: directUrl,
    responseType: 'arraybuffer',
    maxRedirects: 10,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  console.log('Downloaded bytes:', response.data.byteLength);
  fs.writeFileSync(destPath, Buffer.from(response.data));
}

app.post('/render', async (req, res) => {
  const { imageUrl, audioUrl } = req.body;
  console.log('Received request:', { imageUrl, audioUrl });

  const imagePath = '/tmp/input.jpg';
  const audioPath = '/tmp/audio.mp3';
  const outputPath = '/tmp/output.mp4';

  try {
    console.log('Downloading image...');
    await downloadFile(imageUrl, imagePath);

    console.log('Downloading audio...');
    await downloadFile(audioUrl, audioPath);

    console.log('Running FFmpeg...');
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
    console.log('Sending video, size:', video.length);
    res.set('Content-Type', 'video/mp4');
    res.send(video);

  } catch (err) {
    console.error('RENDER FAILED:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.send('FFmpeg server running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));