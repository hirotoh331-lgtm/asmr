class MonoAsmrProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = Math.floor(sampleRate * 0.05);
    
    this.bufferL = new Float32Array(this.frameSize);
    this.bufferR = new Float32Array(this.frameSize);
    this.bufferIndex = 0;

    this.state = 0;
    this.targetMix = [1, 0, 0, 1];
    this.currentMix = [1, 0, 0, 1];

    this.mode = "off"; 
    this.targetEar = 'right';
    this.sensitivityVal = 50;

    this.updateParameters();

    this.port.onmessage = (e) => {
      if (e.data.type === 'config') {
        this.mode = e.data.mode;
        this.targetEar = e.data.targetEar;
        this.sensitivityVal = e.data.sensitivity;
        
        this.updateParameters();

        if (this.mode === "off") {
          this.state = 0; 
          this.targetMix = [1, 0, 0, 1];
          this.currentMix = [1, 0, 0, 1];
        }
      }
    };
  }

  updateParameters() {
    // 0〜100 を -60dB 〜 -20dB の「音量差の閾値」にマッピング
    // 0(鈍感): ターゲット側が-60dB以上小さくならないと発動しない
    // 100(敏感): ターゲット側が-20dB小さくなっただけで発動する
    this.thresholdDiffOn = -60 + (this.sensitivityVal / 100) * 40;
    
    // オフになる閾値（ヒステリシスを設けてチャタリング防止）
    this.thresholdDiffOff = this.thresholdDiffOn + 5; 

    // フェード時間を 250ms (0.25秒) に延長
    const fadeTimeSec = 0.25;
    this.alpha = Math.exp(-1 / (sampleRate * fadeTimeSec));
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0) return true;

    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];

    if (!inL || !outL) return true;

    for (let i = 0; i < inL.length; i++) {
      const l = inL[i];
      const r = inR[i];

      this.bufferL[this.bufferIndex] = l;
      this.bufferR[this.bufferIndex] = r;
      this.bufferIndex++;

      if (this.bufferIndex >= this.frameSize) {
        this.analyzeFrame();
        this.bufferIndex = 0;
      }

      if (this.mode === "off") {
        outL[i] = l;
        outR[i] = r;
      } else {
        for (let j = 0; j < 4; j++) {
          this.currentMix[j] = this.alpha * this.currentMix[j] + (1 - this.alpha) * this.targetMix[j];
        }
        outL[i] = this.currentMix[0] * l + this.currentMix[1] * r;
        outR[i] = this.currentMix[2] * l + this.currentMix[3] * r;
      }
    }
    return true;
  }

  analyzeFrame() {
    let sumL = 0;
    let sumR = 0;
    for (let i = 0; i < this.frameSize; i++) {
      sumL += this.bufferL[i] * this.bufferL[i];
      sumR += this.bufferR[i] * this.bufferR[i];
    }
    const rmsL = Math.sqrt(sumL / this.frameSize);
    const rmsR = Math.sqrt(sumR / this.frameSize);

    const dbL = rmsL > 0.00001 ? 20 * Math.log10(rmsL) : -100;
    const dbR = rmsR > 0.00001 ? 20 * Math.log10(rmsR) : -100;

    if (this.mode === "off") {
      this.targetMix = [1, 0, 0, 1];
      this.state = 0;
    } else if (this.mode === "on") {
      
      // ターゲット耳 - ソース耳 の音量差を計算 (ターゲットが小さいほどマイナスが大きくなる)
      const diffDbRightTarget = dbR - dbL; 
      const diffDbLeftTarget = dbL - dbR;  

      // ノイズによる誤動作を防ぐため、ソース側に一定以上の音量（-80dB）があることも条件とする
      if (this.targetEar === 'right') {
        if (this.state === 0) {
          if (diffDbRightTarget < this.thresholdDiffOn && dbL > -80) {
            this.state = 1; 
          }
        } else if (this.state === 1) {
          if (diffDbRightTarget >= this.thresholdDiffOff || dbL <= -80) {
            this.state = 0;
          }
        }
        this.targetMix = (this.state === 0) ? [1, 0, 0, 1] : [1, 0, 1, 0];
        
      } else if (this.targetEar === 'left') {
        if (this.state === 0) {
          if (diffDbLeftTarget < this.thresholdDiffOn && dbR > -80) {
            this.state = 1;
          }
        } else if (this.state === 1) {
          if (diffDbLeftTarget >= this.thresholdDiffOff || dbR <= -80) {
            this.state = 0;
          }
        }
        this.targetMix = (this.state === 0) ? [1, 0, 0, 1] : [0, 1, 0, 1];
      }
    }

    this.port.postMessage({
      type: 'debug',
      dbL: dbL,
      dbR: dbR,
      state: this.state,
      targetEar: this.targetEar,
      mode: this.mode
    });
  }
}

registerProcessor('mono-asmr-processor', MonoAsmrProcessor);