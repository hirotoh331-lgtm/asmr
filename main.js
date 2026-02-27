const fileInput = document.getElementById('audio-file');
const audioElement = document.getElementById('audio-player');
const toggleBtn = document.getElementById('toggle-mode');
const statusText = document.getElementById('status');
const earRadios = document.querySelectorAll('input[name="target-ear"]');
const sensitivityRadios = document.querySelectorAll('input[name="sensitivity"]');

const dbLElement = document.getElementById('db-l');
const dbRElement = document.getElementById('db-r');
const stateElement = document.getElementById('current-state');

let audioCtx = null;
let workletNode = null;
let sourceNode = null;
let currentMode = "off";
let targetEar = 'right';
let sensitivity = 'medium';

async function initAudio() {
  if (audioCtx) return;
  
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Workletの読み込み（※Live Server環境でないとここでエラーになります）
    await audioCtx.audioWorklet.addModule('processor.js');
    
    // source → workletNode → destination の接続
    sourceNode = audioCtx.createMediaElementSource(audioElement);
    
    // 出力が確実にステレオ(2ch)になるようオプションを指定
    workletNode = new AudioWorkletNode(audioCtx, 'mono-asmr-processor', {
      outputChannelCount: [2]
    });
    
    sourceNode.connect(workletNode);
    workletNode.connect(audioCtx.destination);
    
    workletNode.port.onmessage = (e) => {
      if (e.data.type === 'debug') {
        updateDebugUI(e.data);
      }
    };
    
    sendConfigToWorklet();

  } catch (error) {
    console.error("Audio initialization error:", error);
    alert("音声処理エンジンの起動に失敗しました。\nVS Codeの「Live Server」拡張機能を使用してブラウザで開いているか確認してください。");
  }
}

function sendConfigToWorklet() {
  if (workletNode) {
    workletNode.port.postMessage({
      type: 'config',
      mode: currentMode,
      targetEar: targetEar,
      sensitivity: sensitivity
    });
  }
}

function updateDebugUI(data) {
  dbLElement.textContent = data.dbL.toFixed(1) + ' dB';
  dbRElement.textContent = data.dbR.toFixed(1) + ' dB';

  if (data.mode === "off") {
    stateElement.textContent = '通常再生 (OFF)';
    stateElement.className = 'status-normal';
  } else if (data.state === 0) {
    stateElement.textContent = '通常再生 (監視中)';
    stateElement.className = 'status-normal';
  } else if (data.state === 1) {
    if (data.targetEar === 'right') {
      stateElement.textContent = '左 → 右 補完中';
      stateElement.className = 'status-active';
    } else if (data.targetEar === 'left') {
      stateElement.textContent = '右 → 左 補完中';
      stateElement.className = 'status-active';
    }
  }
}

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const objectUrl = URL.createObjectURL(file);
    audioElement.src = objectUrl;
  }
});

earRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    targetEar = e.target.value;
    sendConfigToWorklet();
  });
});

sensitivityRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    sensitivity = e.target.value;
    sendConfigToWorklet();
  });
});

toggleBtn.addEventListener('change', async (e) => {
  currentMode = e.target.checked ? "on" : "off";
  statusText.textContent = e.target.checked ? "ON" : "OFF";
  statusText.style.color = e.target.checked ? "#007BFF" : "#000";
  
  if (!audioCtx) await initAudio();
  if (audioCtx && audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  sendConfigToWorklet();
});

// 再生ボタン押下時にも確実にAudioContextをresumeさせる
audioElement.addEventListener('play', async () => {
  if (!audioCtx) await initAudio();
  if (audioCtx && audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  sendConfigToWorklet();
});