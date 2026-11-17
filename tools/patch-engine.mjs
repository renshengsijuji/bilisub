import fs from 'node:fs';

const mainPath = 'E:/Deepseek/bili-sub/engine/main.py';
const catPath = 'E:/Deepseek/bili-sub/engine/catalog.json';

let s = fs.readFileSync(mainPath, 'utf8');

// 1) urllib 导入
if (!s.includes('import urllib.request')) {
  s = s.replace('import time\n', 'import time\nimport urllib.request\n');
  console.log('added urllib import');
}

// 2) ASR 语言参数
const oldTranscribe = `    def transcribe(self, pcm_bytes):
        import numpy as np
        audio = np.frombuffer(pcm_bytes, dtype="<i2").astype("float32") / 32768.0
        return self.get_asr().transcribe(audio)`;
const newTranscribe = `    def transcribe(self, pcm_bytes, language="en"):
        import numpy as np
        audio = np.frombuffer(pcm_bytes, dtype="<i2").astype("float32") / 32768.0
        return self.get_asr().transcribe(audio, language=language)`;
if (s.includes(oldTranscribe)) {
  s = s.split(oldTranscribe).join(newTranscribe);
  console.log('patched transcribe()');
}

const oldCall = 'text = await asyncio.to_thread(self.engine.transcribe, chunk)';
const newCall = 'text = await asyncio.to_thread(self.engine.transcribe, chunk, self.language)';
if (s.includes(oldCall)) {
  s = s.split(oldCall).join(newCall);
  console.log('patched AudioSession call');
}

fs.writeFileSync(mainPath, s, 'utf8');

// 3) 精简模型清单
const catalog = JSON.parse(fs.readFileSync(catPath, 'utf8'));
const keep = new Set(['mt-opus-en-zh', 'mt-nllb-600m', 'asr-whisper-small']);
const slim = catalog.filter((m) => keep.has(m.id));
fs.writeFileSync(catPath, JSON.stringify(slim, null, 2) + '\n', 'utf8');
console.log('catalog:', slim.map((m) => m.id).join(', '));
