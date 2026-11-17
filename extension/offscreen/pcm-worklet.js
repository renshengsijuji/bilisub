/*!
 * AudioWorklet：把音频降采样到 16kHz / 16bit 单声道，按块发给页面
 * 采用简单的等间隔均值（box filter）做抗混叠，足够语音识别使用
 */
class PCM16K extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = 0;
    this.count = 0;
    this.buffer = new Int16Array(2048);
    this.length = 0;
  }

  flush() {
    if (this.length) {
      const out = this.buffer.slice(0, this.length);
      this.port.postMessage(out.buffer, [out.buffer]);
      this.length = 0;
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;

    const channel = input[0];
    for (let i = 0; i < channel.length; i++) {
      this.acc += channel[i];
      this.count++;
      if (this.count >= this.ratio) {
        let value = this.acc / this.count;
        value = Math.max(-1, Math.min(1, value));
        this.buffer[this.length++] = value * 32767;
        this.acc = 0;
        this.count = 0;
        if (this.length >= this.buffer.length) this.flush();
      }
    }
    return true;
  }
}

registerProcessor('pcm16k', PCM16K);
