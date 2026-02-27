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

    this.setSensitivity('medium');

    this.port.onmessage = (e) => {
      if (e.data.type === 'config') {
        this.mode = e.data.mode;
        this.targetEar = e.data.targetEar;
        this.setSensitivity(e.data.sensitivity);

        if (this.mode === "off") {
          this.state = 0; 
          this.targetMix = [1, 0, 0, 1];
          this.currentMix = [1, 0, 0, 1];
        }
      }
    };
  }

  setSensitivity(level) {
    let thresholdDbOn, thresholdDbOff, fadeTimeSec;

    switch (level) {
      case 'low':
        thresholdDbOn = -45;
        thresholdDbOff = -40;
        fadeTimeSec = 0.02;
        break;
      case 'high':
        thresholdDbOn = -25;
        thresholdDbOff = -20;
        fadeTimeSec = 0.3;
        break;
      case 'medium':
      default:
        thresholdDbOn = -35;
        thresholdDbOff = -30;
        fadeTimeSec = 0.1;
        break;
    }

    this.thresholdOn = Math.pow(10, thresholdDbOn / 20);
    this.thresholdOff = Math.pow(10, thresholdDbOff / 20);
    this.alpha = Math.exp(-1 / (sampleRate * fadeTimeSec));
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    // 入力データ自体がない場合はスキップ
    if (!input || input.length === 0) return true;

    // モノラル（1ch）入力の場合は、左の音を右にもコピーして処理を続行する
    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];

    // 安全対策
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
      if (this.targetEar === 'right') {
        if (this.state === 0) {
          if (rmsR < this.thresholdOn && rmsL >= this.thresholdOn) {
            this.state = 1; 
          }
        } else if (this.state === 1) {
          if (rmsR >= this.thresholdOff || rmsL < this.thresholdOn) {
            this.state = 0;
          }
        }
        this.targetMix = (this.state === 0) ? [1, 0, 0, 1] : [1, 0, 1, 0];
      } else if (this.targetEar === 'left') {
        if (this.state === 0) {
          if (rmsL < this.thresholdOn && rmsR >= this.thresholdOn) {
            this.state = 1;
          }
        } else if (this.state === 1) {
          if (rmsL >= this.thresholdOff || rmsR < this.thresholdOn) {
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