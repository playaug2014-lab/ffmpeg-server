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
  const { videoUrls, audioUrl, duration, title } = req.query;
  const maxDuration = parseInt(duration) || 60;
  const videoList = videoUrls.split(',');
  const audioPath = '/tmp/audio.mp3';
  const outputPath = '/tmp/output.mp4';
  const concatPath = '/tmp/concat.txt';
  const videoPaths = [];

  try {
    // Download all video clips
    for (let i = 0; i < videoList.length; i++) {
      const vPath = `/tmp/video_${i}.mp4`;
      console.log(`Downloading video ${i + 1}/${videoList.length}`);
      await downloadFile(videoList[i], vPath);
      videoPaths.push(vPath);
    }
    console.log('All videos downloaded!');

    // Download audio
    console.log('Downloading audio...');
    await downloadFile(audioUrl, audioPath);
    console.log('Audio downloaded!');

    // Create concat file — repeat clips to fill duration
    const singleClipDuration = Math.floor(maxDuration / videoList.length);
    let concatContent = '';
    for (const vPath of videoPaths) {
      concatContent += `file '${vPath}'\n`;
    }
    // Write concat list
    fs.writeFileSync(concatPath, concatContent);

    console.log('Max duration:', maxDuration);
    console.log('Clips:', videoList.length);

    // Step 1 — concat all clips into one video
    const concatOutput = '/tmp/concat_output.mp4';
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatPath)
        .inputOptions([
          '-f', 'concat',
          '-safe', '0',
          '-stream_loop', '3',           // ✅ loop the whole concat 3 times
        ])
        .videoCodec('libx264')
        .outputOptions([
          '-t', maxDuration.toString(),
          '-preset ultrafast',
          '-crf 28',
          '-an',                         // no audio yet
        ])
        .output(concatOutput)
        .on('end', () => { console.log('Concat done!'); resolve(); })
        .on('error', reject)
        .run();
    });

    // Step 2 — add audio + text overlay
    const videoTitle = title || 'Watch Till End!';
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatOutput)
        .input(audioPath)
        .inputOptions(['-stream_loop', '-1'])  // loop audio
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-map 0:v:0',
          '-map 1:a:0',
          '-t', maxDuration.toString(),
          '-preset ultrafast',
          '-crf 28',
          '-threads 1',
          '-ar 44100',                   // ✅ stereo audio
          '-ac 2',
          '-b:a 192k',
          // ✅ text overlay at top
          `-vf drawtext=text='${videoTitle}':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=40:box=1:boxcolor=black@0.5:boxborderw=10`,
        ])
        .output(outputPath)
        .on('start', cmd => console.log('FFmpeg cmd:', cmd))
        .on('end', () => { console.log('FFmpeg done!'); resolve(); })
        .on('error', reject)
        .run();
    });

    const video = fs.readFileSync(outputPath);
    res.set('Content-Type', 'video/mp4');
    res.send(video);

  } catch (err) {
    console.error('ERROR:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    // Cleanup
    [...videoPaths, audioPath, outputPath, concatPath, '/tmp/concat_output.mp4']
      .forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
  }
});

app.get('/', (req, res) => res.send('FFmpeg server running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));