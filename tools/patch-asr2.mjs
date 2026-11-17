import fs from 'node:fs';

const path = 'E:/Deepseek/bili-sub/engine/main.py';
let s = fs.readFileSync(path, 'utf8');

const before = (s.match(/self\.asr = None/g) || []).length;
s = s.split('self.asr = None').join('self.asr = {}');
console.log('asr cache init patched:', before);

const oldAsr = '"asr": self.cfg.get("asr", {}),';
const newAsr = '"asr": {"model": self._asr_model_id("quality"), "realtime": self._asr_model_id("realtime")},';
if (s.includes(oldAsr)) {
  s = s.split(oldAsr).join(newAsr);
  console.log('welcome asr patched');
} else {
  console.log('welcome asr NOT found');
}

fs.writeFileSync(path, s, 'utf8');
