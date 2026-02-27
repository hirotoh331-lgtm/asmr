class MonoAsmrProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = Math.floor(sampleRate * 0.05); // 約50msごとの解析
    
    this.bufferL = new Float32Array(this.frameSize);
    this.bufferR = new Float32Array(this.frameSize);
    this.bufferIndex = 0;

    this.state = 0;
    this.targetMix = [1, 0, 0, 1];
    this.currentMix = [1, 0, 0, 1];

    this.mode = "off"; 
    this.targetEar = 'right';
    this.sensitivityVal = 80;

    // 安定化のための連続フレームカウンタ
    this.framesMetOn = 0;
    this.framesMetOff = 0;
    this.REQUIRED_FRAMES = 3; // 約150ms連続で条件を満たした場合に発動/解除

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
          this.framesMetOn = 0;
          this.framesMetOff = 0;
        }
      }
    };
  }

  updateParameters() {
    // 0(鈍感) = 3.0dB差, 100(敏感) = 0.2dB差 にマッピング
    this.thresholdOn = 3.0 - (this.sensitivityVal / 100) * 2.8;
    
    // ヒステリシス: オンになる閾値より 0.2dB 小さくなったらオフにする (チャタリング防止)
    this.thresholdOff = Math.max(0.05, this.thresholdOn - 0.2); 

    const fadeTimeSec = 0.25;
    this.alpha = Math.exp(-1 / (sampleRate * fadeTimeSec));
  }

  // 判定用シグナルへの軽いコンプレッション (突発的なピークを抑えて判定を安定させる)
  compressForAnalysis(db) {
    const threshold = -35; 
    const ratio = 1.5; 
    if (db > threshold) {
      return threshold + (db - threshold) / ratio;
    }
    return db;
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

    // 生のdB値
    const rawDbL = rmsL > 0.00001 ? 20 * Math.log10(rmsL) : -100;
    const rawDbR = rmsR > 0.00001 ? 20 * Math.log10(rmsR) : -100;

    // 判定用にコンプレッションを適用したdB値
    const compDbL = this.compressForAnalysis(rawDbL);
    const compDbR = this.compressForAnalysis(rawDbR);

    if (this.mode === "off") {
      this.targetMix = [1, 0, 0, 1];
      this.state = 0;
    } else if (this.mode === "on") {
      
      let sourceDb, targetDb;
      if (this.targetEar === 'right') {
        sourceDb = compDbL; // 健常な耳（音源）
        targetDb = compDbR; // 聞こえにくい耳（補完先）
      } else {
        sourceDb = compDbR;
        targetDb = compDbL;
      }

      // 「健常な耳」に対して「聞こえにくい耳」がどれだけ小さいか（dB差）
      const diffDb = sourceDb - targetDb; 

      // 誤動作防止の足切り（ソース側が-80dB以下の完全無音の場合は動作しない）
      const minSourceDb = -80;

      if (this.state === 0) {
        // ONになる条件：ターゲット側が指定値(0.2〜3.0dB)以上小さく、かつ音源が存在する
        if (diffDb >= this.thresholdOn && sourceDb > minSourceDb) {
          this.framesMetOn++;
          this.framesMetOff = 0;
          if (this.framesMetOn >= this.REQUIRED_FRAMES) {
            this.state = 1;
            this.framesMetOn = 0; // リセット
          }
        } else {
          this.framesMetOn = 0;
        }
      } else if (this.state === 1) {
        // OFFになる条件：差がヒステリシス閾値を下回る、または音が無くなった
        if (diffDb < this.thresholdOff || sourceDb <= minSourceDb) {
          this.framesMetOff++;
          this.framesMetOn = 0;
          if (this.framesMetOff >= this.REQUIRED_FRAMES) {
            this.state = 0;
            this.framesMetOff = 0; // リセット
          }
        } else {
          this.framesMetOff = 0;
        }
      }

      if (this.targetEar === 'right') {
        this.targetMix = (this.state === 0) ? [1, 0, 0, 1] : [1, 0, 1, 0];
      } else {
        this.targetMix = (this.state === 0) ? [1, 0, 0, 1] : [0, 1, 0, 1];
      }
    }

    // メインスレッドには「生のdB値」と「生の差分」を送って正確な数値を表示させる
    this.port.postMessage({
      type: 'debug',
      dbL: rawDbL,
      dbR: rawDbR,
      diff: Math.abs(rawDbL - rawDbR),
      state: this.state,
      targetEar: this.targetEar,
      mode: this.mode
    });
  }
}

registerProcessor('mono-asmr-processor', MonoAsmrProcessor);