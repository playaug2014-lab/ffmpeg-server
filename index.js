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

async function imageToSegment(imagePath, outputPath, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(imagePath)
      .inputOptions(['-loop', '1'])
      .outputOptions([
        '-t', duration.toString(),
        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',         // ✅ ADDED
        '-preset', 'ultrafast',
        '-crf', '28',
        '-an'
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

app.get('/render', async (req, res) => {
  const { videoUrls, audioUrl, duration } = req.query;
  const maxDuration = parseInt(duration) || 180;
  const urlList = (videoUrls || '').split('|').filter(Boolean).slice(0, 6);
  const audioPath = '/tmp/audio.mp3';
  const outputPath = '/tmp/output.mp4';
  const concatPath = '/tmp/concat.txt';
  const imagePaths = [];
  const segmentPaths = [];

  try {
    for (let i = 0; i < urlList.length; i++) {
      const imgPath = `/tmp/image_${i}.png`;
      console.log(`Downloading image ${i + 1}/${urlList.length}...`);
      await downloadFile(urlList[i], imgPath);
      imagePaths.push(imgPath);
      console.log(`Image ${i + 1} downloaded!`);
    }

    const segmentDuration = Math.floor(maxDuration / urlList.length);
    console.log(`Each segment duration: ${segmentDuration}s`);

    for (let i = 0; i < imagePaths.length; i++) {
      const segPath = `/tmp/seg_${i}.mp4`;
      console.log(`Converting image ${i + 1} to segment...`);
      await imageToSegment(imagePaths[i], segPath, segmentDuration);
      segmentPaths.push(segPath);
      console.log(`Segment ${i + 1} done!`);
    }

    console.log('Downloading audio...');
    await downloadFile(audioUrl, audioPath);
    console.log('Audio downloaded!');

    let concatContent = '';
    for (const segPath of segmentPaths) {
      concatContent += `file '${segPath}'\n`;
    }
    fs.writeFileSync(concatPath, concatContent);
    console.log('Max duration:', maxDuration);
    console.log('Total segments:', segmentPaths.length);

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
          '-pix_fmt', 'yuv420p',       // ✅ ADDED
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
    [...imagePaths, ...segmentPaths, audioPath, outputPath, concatPath].forEach(f => {
      try { fs.unlinkSync(f); } catch (_) {}
    });
  }
});

app.get('/', (req, res) => res.send('FFmpeg server running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));