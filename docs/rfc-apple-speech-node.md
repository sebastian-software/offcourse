# RFC: local-transcribe

> Multi-backend local speech recognition for Node.js

## Summary

A standalone npm package providing unified access to multiple local speech-to-text engines:
- **Apple Speech Framework** (native macOS)
- **Whisper.cpp** (cross-platform, GGML)
- **ONNX Runtime** (Parakeet, Canary - NVIDIA NeMo models)

All processing happens on-device without external API dependencies.

## Motivation

Current options for local speech recognition in Node.js are fragmented:

| Solution | Pros | Cons |
|----------|------|------|
| `nodejs-whisper` | Works everywhere | Large models (500MB+), slower |
| OpenAI Whisper API | High quality | Requires internet, costs money |
| `whisperkit-cli` | Fast on Apple Silicon | External binary, not native JS |
| Apple Speech | Native, fast | macOS only |
| NVIDIA Parakeet | Fastest, 25 languages | No Node.js bindings |

**This package unifies all local options under one API.**

## Supported Backends

### 1. Apple Speech Framework (macOS)
- **On-device processing** - No data leaves the machine
- **Optimized for Apple Silicon** - Uses Neural Engine
- **Pre-installed models** - No download required
- **50+ languages** supported
- **Free** - No API costs

### 2. NVIDIA NeMo Models via ONNX Runtime

From [NVIDIA's August 2025 release](https://blogs.nvidia.com/blog/speech-ai-dataset-models/):

| Model | Parameters | Languages | Focus | Speed |
|-------|------------|-----------|-------|-------|
| **Parakeet-tdt-0.6b-v3** | 600M | 25 EU langs | Throughput | ⚡⚡⚡⚡ |
| **Canary-1b-v2** | 1B | 25 EU langs | Accuracy + Translation | ⚡⚡⚡ |

**Supported Languages:** English, German, French, Spanish, Italian, Portuguese, Dutch, Polish, Czech, Slovak, Hungarian, Romanian, Bulgarian, Greek, Swedish, Danish, Finnish, Norwegian, Croatian, Slovenian, Estonian, Latvian, Lithuanian, Maltese, Russian, Ukrainian

**Key Features:**
- 🚀 Highest throughput of multilingual models on HuggingFace
- 🎯 24-minute audio in single inference pass
- 🔍 Auto language detection (no prompting needed)
- ✨ Punctuation, capitalization, word-level timestamps
- 📦 Available on HuggingFace under permissive license

### 3. Whisper.cpp (Cross-platform fallback)
- Works on macOS, Linux, Windows
- Metal acceleration on Apple Silicon
- Models: tiny (75MB) → large (3GB)
- 99 languages supported

## Technical Design

### Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         local-transcribe                              │
├──────────────────────────────────────────────────────────────────────┤
│  Unified TypeScript API                                               │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │ import { transcribe, setBackend } from 'local-transcribe';       ││
│  │                                                                   ││
│  │ // Auto-select best backend                                       ││
│  │ const result = await transcribe('audio.wav', { language: 'de' });││
│  │                                                                   ││
│  │ // Or explicit backend                                            ││
│  │ setBackend('parakeet');  // NVIDIA Parakeet v3                   ││
│  │ setBackend('apple');     // Apple Speech Framework               ││
│  │ setBackend('whisper');   // Whisper.cpp                          ││
│  └──────────────────────────────────────────────────────────────────┘│
├──────────────────────────────────────────────────────────────────────┤
│  Backend Adapters                                                     │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────┐  │
│  │ AppleBackend     │ │ ParakeetBackend  │ │ WhisperBackend       │  │
│  │ (N-API + ObjC++) │ │ (ONNX Runtime)   │ │ (whisper.cpp bind)   │  │
│  ├──────────────────┤ ├──────────────────┤ ├──────────────────────┤  │
│  │ • SFSpeech       │ │ • onnxruntime    │ │ • GGML models        │  │
│  │ • Neural Engine  │ │ • CoreML EP      │ │ • Metal acceleration │  │
│  │ • 50+ languages  │ │ • 25 EU langs    │ │ • 99 languages       │  │
│  │ • macOS only     │ │ • Cross-platform │ │ • Cross-platform     │  │
│  └────────┬─────────┘ └────────┬─────────┘ └──────────┬───────────┘  │
│           │                    │                      │              │
├───────────┴────────────────────┴──────────────────────┴──────────────┤
│  Native Layer                                                         │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────┐  │
│  │ Speech.framework │ │ ONNX Runtime     │ │ whisper.cpp          │  │
│  │ (macOS)          │ │ + CoreML EP      │ │ + Metal              │  │
│  └──────────────────┘ └──────────────────┘ └──────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Project Structure

```
local-transcribe/
├── package.json
├── tsconfig.json
├── binding.gyp                    # Node-gyp build config
├── src/
│   ├── index.ts                   # Unified API
│   ├── types.ts                   # Type definitions
│   ├── backend.ts                 # Backend selection logic
│   ├── backends/
│   │   ├── apple/
│   │   │   ├── index.ts           # Apple backend adapter
│   │   │   └── native/
│   │   │       ├── transcribe.mm  # Objective-C++ implementation
│   │   │       └── binding.cpp    # N-API bindings
│   │   ├── parakeet/
│   │   │   ├── index.ts           # Parakeet backend adapter
│   │   │   ├── model.ts           # Model loading/caching
│   │   │   └── processor.ts       # Audio preprocessing
│   │   └── whisper/
│   │       ├── index.ts           # Whisper backend adapter
│   │       └── native/            # whisper.cpp bindings
│   └── utils/
│       ├── audio.ts               # Audio format conversion
│       └── download.ts            # Model download manager
├── models/                        # Downloaded models (gitignored)
├── lib/                           # Compiled JS output
├── build/                         # Native addon output
└── test/
    ├── backends/
    │   ├── apple.test.ts
    │   ├── parakeet.test.ts
    │   └── whisper.test.ts
    └── fixtures/
        ├── sample-en.wav
        └── sample-de.wav
```

### API Design

```typescript
// Backend types
export type BackendType = 'auto' | 'apple' | 'parakeet' | 'canary' | 'whisper';

export type ParakeetModel = 'parakeet-tdt-0.6b-v3';
export type CanaryModel = 'canary-1b-v2';
export type WhisperModel = 'tiny' | 'base' | 'small' | 'medium' | 'large';

// Main transcription function
export function transcribe(
  audioPath: string,
  options?: TranscribeOptions
): Promise<TranscriptionResult>;

// Backend management
export function setBackend(backend: BackendType, options?: BackendOptions): void;
export function getAvailableBackends(): BackendInfo[];
export function downloadModel(backend: BackendType, model?: string): Promise<void>;

// Types
export interface TranscribeOptions {
  language?: string;           // Default: auto-detect
  backend?: BackendType;       // Override default backend
  onProgress?: (partial: PartialResult) => void;
}

export interface BackendOptions {
  model?: string;              // Model variant
  modelPath?: string;          // Custom model path
  useGPU?: boolean;            // Use GPU acceleration (default: true)
}

export interface BackendInfo {
  name: BackendType;
  available: boolean;
  languages: string[];
  models: string[];
  requiresDownload: boolean;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
  words?: WordTimestamp[];     // Word-level timestamps (Parakeet/Canary)
  duration: number;            // Audio duration in seconds
  processingTime: number;      // Time taken to transcribe
  language: string;            // Detected or specified language
  backend: BackendType;        // Which backend was used
}

export interface TranscriptionSegment {
  text: string;
  start: number;               // Start time in seconds
  end: number;                 // End time in seconds
  confidence?: number;         // 0.0 - 1.0
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface PartialResult {
  text: string;
  isFinal: boolean;
}
```

### Native Implementation: Apple Speech

```objc
// src/backends/apple/native/transcribe.mm

#import <Speech/Speech.h>
#import <AVFoundation/AVFoundation.h>
#include <napi.h>

class TranscribeWorker : public Napi::AsyncWorker {
public:
    TranscribeWorker(
        Napi::Env env,
        Napi::Promise::Deferred deferred,
        std::string audioPath,
        std::string language,
        bool onDeviceOnly
    ) : Napi::AsyncWorker(env),
        deferred_(deferred),
        audioPath_(audioPath),
        language_(language),
        onDeviceOnly_(onDeviceOnly) {}

    void Execute() override {
        @autoreleasepool {
            NSLocale* locale = [NSLocale localeWithLocaleIdentifier:
                [NSString stringWithUTF8String:language_.c_str()]];

            SFSpeechRecognizer* recognizer = [[SFSpeechRecognizer alloc]
                initWithLocale:locale];

            if (!recognizer || !recognizer.isAvailable) {
                SetError("Speech recognizer not available for this language");
                return;
            }

            NSURL* url = [NSURL fileURLWithPath:
                [NSString stringWithUTF8String:audioPath_.c_str()]];

            SFSpeechURLRecognitionRequest* request =
                [[SFSpeechURLRecognitionRequest alloc] initWithURL:url];

            request.requiresOnDeviceRecognition = onDeviceOnly_;
            request.shouldReportPartialResults = NO;

            dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
            __block NSString* resultText = nil;
            __block NSError* resultError = nil;

            [recognizer recognitionTaskWithRequest:request
                resultHandler:^(SFSpeechRecognitionResult* result, NSError* error) {
                    if (error) {
                        resultError = error;
                        dispatch_semaphore_signal(semaphore);
                        return;
                    }
                    if (result.isFinal) {
                        resultText = result.bestTranscription.formattedString;
                        dispatch_semaphore_signal(semaphore);
                    }
                }];

            dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);

            if (resultError) {
                SetError([[resultError localizedDescription] UTF8String]);
            } else if (resultText) {
                result_ = [resultText UTF8String];
            }
        }
    }

    void OnOK() override {
        Napi::Object result = Napi::Object::New(Env());
        result.Set("text", result_);
        deferred_.Resolve(result);
    }

    void OnError(const Napi::Error& error) override {
        deferred_.Reject(error.Value());
    }

private:
    Napi::Promise::Deferred deferred_;
    std::string audioPath_;
    std::string language_;
    bool onDeviceOnly_;
    std::string result_;
};

Napi::Value Transcribe(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Audio path required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string audioPath = info[0].As<Napi::String>();
    std::string language = "en-US";
    bool onDeviceOnly = true;

    if (info.Length() > 1 && info[1].IsObject()) {
        Napi::Object options = info[1].As<Napi::Object>();
        if (options.Has("language")) {
            language = options.Get("language").As<Napi::String>();
        }
        if (options.Has("onDeviceOnly")) {
            onDeviceOnly = options.Get("onDeviceOnly").As<Napi::Boolean>();
        }
    }

    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    TranscribeWorker* worker = new TranscribeWorker(
        env, deferred, audioPath, language, onDeviceOnly
    );
    worker->Queue();

    return deferred.Promise();
}

Napi::Value IsAvailable(const Napi::CallbackInfo& info) {
    @autoreleasepool {
        SFSpeechRecognizer* recognizer = [[SFSpeechRecognizer alloc] init];
        return Napi::Boolean::New(info.Env(),
            recognizer != nil && recognizer.isAvailable);
    }
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("transcribe", Napi::Function::New(env, Transcribe));
    exports.Set("isAvailable", Napi::Function::New(env, IsAvailable));
    return exports;
}

NODE_API_MODULE(apple_speech, Init)
```

### Build Configuration

```python
# binding.gyp
{
  "targets": [
    {
      "target_name": "apple_speech",
      "conditions": [
        ["OS=='mac'", {
          "sources": [
            "src/native/transcribe.mm",
            "src/native/binding.cpp"
          ],
          "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include\")"
          ],
          "libraries": [
            "-framework Speech",
            "-framework Foundation",
            "-framework AVFoundation"
          ],
          "xcode_settings": {
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "MACOSX_DEPLOYMENT_TARGET": "12.0",
            "OTHER_CFLAGS": ["-fobjc-arc"]
          },
          "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
        }]
      ]
    }
  ]
}
```

### Parakeet/Canary Backend (ONNX Runtime)

```typescript
// src/backends/parakeet/index.ts

import * as ort from 'onnxruntime-node';
import { AudioProcessor } from './processor.js';
import { ModelManager } from '../../utils/download.js';
import type { TranscriptionResult, BackendOptions } from '../../types.js';

const MODELS = {
  'parakeet-tdt-0.6b-v3': {
    url: 'https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3/resolve/main/model.onnx',
    size: '600MB',
    languages: 25,
  },
  'canary-1b-v2': {
    url: 'https://huggingface.co/nvidia/canary-1b-v2/resolve/main/model.onnx',
    size: '1.2GB',
    languages: 25,
    supportsTranslation: true,
  },
} as const;

export class ParakeetBackend {
  private session: ort.InferenceSession | null = null;
  private processor: AudioProcessor;
  private modelManager: ModelManager;

  constructor(options: BackendOptions = {}) {
    this.processor = new AudioProcessor();
    this.modelManager = new ModelManager();
  }

  async initialize(model: keyof typeof MODELS = 'parakeet-tdt-0.6b-v3'): Promise<void> {
    const modelPath = await this.modelManager.ensureModel(model, MODELS[model].url);

    // Use CoreML Execution Provider on macOS for GPU acceleration
    const sessionOptions: ort.InferenceSession.SessionOptions = {
      executionProviders: [
        { name: 'coreml' },  // Apple Silicon GPU
        { name: 'cpu' },     // Fallback
      ],
    };

    this.session = await ort.InferenceSession.create(modelPath, sessionOptions);
  }

  async transcribe(audioPath: string): Promise<TranscriptionResult> {
    if (!this.session) {
      throw new Error('Backend not initialized. Call initialize() first.');
    }

    const startTime = performance.now();

    // Preprocess audio to mel spectrogram
    const { melSpectrogram, duration } = await this.processor.processAudio(audioPath);

    // Run inference
    const feeds = {
      audio_signal: new ort.Tensor('float32', melSpectrogram.data, melSpectrogram.shape),
      length: new ort.Tensor('int64', [BigInt(melSpectrogram.shape[2])], [1]),
    };

    const results = await this.session.run(feeds);

    // Decode output tokens to text
    const { text, segments, words } = this.processor.decodeOutput(results);

    return {
      text,
      segments,
      words,
      duration,
      processingTime: (performance.now() - startTime) / 1000,
      language: 'auto', // Parakeet v3 auto-detects
      backend: 'parakeet',
    };
  }

  isAvailable(): boolean {
    return true; // ONNX Runtime works everywhere
  }

  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
  }
}
```

### Audio Processor

```typescript
// src/backends/parakeet/processor.ts

import { execSync } from 'child_process';
import { readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export class AudioProcessor {
  /**
   * Convert audio to 16kHz mono WAV and extract mel spectrogram
   */
  async processAudio(audioPath: string): Promise<{
    melSpectrogram: { data: Float32Array; shape: number[] };
    duration: number;
  }> {
    // Convert to 16kHz mono WAV using ffmpeg
    const tempWav = join(tmpdir(), `transcribe-${Date.now()}.wav`);

    execSync(
      `ffmpeg -i "${audioPath}" -ar 16000 -ac 1 -f wav "${tempWav}" -y`,
      { stdio: 'pipe' }
    );

    // Read WAV and compute mel spectrogram
    const wavData = readFileSync(tempWav);
    unlinkSync(tempWav);

    const samples = this.decodeWav(wavData);
    const duration = samples.length / 16000;
    const melSpectrogram = this.computeMelSpectrogram(samples);

    return { melSpectrogram, duration };
  }

  private decodeWav(buffer: Buffer): Float32Array {
    // Skip WAV header (44 bytes) and read PCM data
    const pcmData = buffer.subarray(44);
    const samples = new Float32Array(pcmData.length / 2);

    for (let i = 0; i < samples.length; i++) {
      samples[i] = pcmData.readInt16LE(i * 2) / 32768;
    }

    return samples;
  }

  private computeMelSpectrogram(samples: Float32Array): {
    data: Float32Array;
    shape: number[];
  } {
    // Mel spectrogram computation (simplified)
    // In production, use proper FFT library like fft.js
    const nFft = 512;
    const hopLength = 160;
    const nMels = 80;
    const nFrames = Math.floor((samples.length - nFft) / hopLength) + 1;

    const melSpec = new Float32Array(nMels * nFrames);
    // ... actual mel spectrogram computation ...

    return {
      data: melSpec,
      shape: [1, nMels, nFrames],
    };
  }

  decodeOutput(results: Record<string, unknown>): {
    text: string;
    segments: Array<{ text: string; start: number; end: number }>;
    words: Array<{ word: string; start: number; end: number }>;
  } {
    // Decode CTC/TDT output tokens using vocabulary
    // Implementation depends on model architecture
    return {
      text: '',
      segments: [],
      words: [],
    };
  }
}
```

### TypeScript Wrapper (Unified API)

```typescript
// src/index.ts
import { platform } from 'os';
import type {
  BackendType,
  TranscribeOptions,
  TranscriptionResult,
  BackendInfo,
} from './types.js';

// Lazy-loaded backends
let appleBackend: import('./backends/apple/index.js').AppleBackend | null = null;
let parakeetBackend: import('./backends/parakeet/index.js').ParakeetBackend | null = null;
let whisperBackend: import('./backends/whisper/index.js').WhisperBackend | null = null;

let currentBackend: BackendType = 'auto';

/**
 * Get list of available backends on this system
 */
export function getAvailableBackends(): BackendInfo[] {
  const backends: BackendInfo[] = [];

  // Apple Speech (macOS only)
  if (platform() === 'darwin') {
    backends.push({
      name: 'apple',
      available: true,
      languages: ['de', 'en', 'fr', 'es', 'it', /* ... 50+ */],
      models: ['default'],
      requiresDownload: false,
    });
  }

  // Parakeet (ONNX - cross-platform)
  backends.push({
    name: 'parakeet',
    available: true,
    languages: ['de', 'en', 'fr', 'es', 'it', 'pt', 'nl', 'pl', /* ... 25 EU */],
    models: ['parakeet-tdt-0.6b-v3'],
    requiresDownload: true,
  });

  // Canary (ONNX - cross-platform)
  backends.push({
    name: 'canary',
    available: true,
    languages: ['de', 'en', 'fr', 'es', 'it', 'pt', 'nl', 'pl', /* ... 25 EU */],
    models: ['canary-1b-v2'],
    requiresDownload: true,
  });

  // Whisper (cross-platform fallback)
  backends.push({
    name: 'whisper',
    available: true,
    languages: ['de', 'en', 'fr', 'es', /* ... 99 */],
    models: ['tiny', 'base', 'small', 'medium', 'large'],
    requiresDownload: true,
  });

  return backends;
}

/**
 * Set the default backend
 */
export function setBackend(backend: BackendType): void {
  currentBackend = backend;
}

/**
 * Auto-select the best available backend
 */
function selectBestBackend(language?: string): BackendType {
  // Prefer Apple on macOS (fastest, no download)
  if (platform() === 'darwin') {
    return 'apple';
  }

  // Parakeet for EU languages (fastest ONNX)
  const euLanguages = ['de', 'en', 'fr', 'es', 'it', 'pt', 'nl', 'pl'];
  if (!language || euLanguages.includes(language.split('-')[0])) {
    return 'parakeet';
  }

  // Whisper for everything else
  return 'whisper';
}

/**
 * Main transcription function
 */
export async function transcribe(
  audioPath: string,
  options: TranscribeOptions = {}
): Promise<TranscriptionResult> {
  const backend = options.backend ??
    (currentBackend === 'auto' ? selectBestBackend(options.language) : currentBackend);

  switch (backend) {
    case 'apple': {
      if (!appleBackend) {
        const { AppleBackend } = await import('./backends/apple/index.js');
        appleBackend = new AppleBackend();
      }
      return appleBackend.transcribe(audioPath, options);
    }

    case 'parakeet':
    case 'canary': {
      if (!parakeetBackend) {
        const { ParakeetBackend } = await import('./backends/parakeet/index.js');
        parakeetBackend = new ParakeetBackend();
        await parakeetBackend.initialize(
          backend === 'canary' ? 'canary-1b-v2' : 'parakeet-tdt-0.6b-v3'
        );
      }
      return parakeetBackend.transcribe(audioPath);
    }

    case 'whisper': {
      if (!whisperBackend) {
        const { WhisperBackend } = await import('./backends/whisper/index.js');
        whisperBackend = new WhisperBackend();
        await whisperBackend.initialize();
      }
      return whisperBackend.transcribe(audioPath, options);
    }

    default:
      throw new Error(`Unknown backend: ${backend}`);
  }
}

/**
 * Download model for a backend
 */
export async function downloadModel(
  backend: BackendType,
  model?: string
): Promise<void> {
  const { ModelManager } = await import('./utils/download.js');
  const manager = new ModelManager();
  await manager.download(backend, model);
}

// Re-export types
export * from './types.js';
```

## Requirements

### System Requirements

- **Node.js 18+**
- **ffmpeg** (for audio preprocessing)
- **macOS 12.0+** (for Apple Speech backend)
- **Xcode Command Line Tools** (for building native addons on macOS)

### Runtime Requirements

- Apple backend: User must grant speech recognition permission on first use
- Parakeet/Canary: ~600MB-1.2GB model download on first use
- Whisper: ~75MB-3GB model download depending on variant

## Installation

```bash
npm install local-transcribe
```

The package will:
1. Install `onnxruntime-node` for ONNX models
2. On macOS: Compile Apple Speech native addon
3. Optionally: Install whisper.cpp bindings

### Model Downloads

```bash
# Download Parakeet model (recommended for German)
npx local-transcribe download parakeet

# Download Canary model (for translation)
npx local-transcribe download canary

# Download Whisper model
npx local-transcribe download whisper --model small
```

## Usage Examples

### Basic Transcription (Auto Backend)

```typescript
import { transcribe } from 'local-transcribe';

// Automatically selects best backend for your system
const result = await transcribe('./recording.wav', {
  language: 'de'
});

console.log(result.text);
console.log(`Transcribed in ${result.processingTime}s using ${result.backend}`);
```

### Explicit Backend Selection

```typescript
import { transcribe, setBackend, downloadModel } from 'local-transcribe';

// Use Parakeet for German (fastest for EU languages)
await downloadModel('parakeet');
setBackend('parakeet');

const result = await transcribe('./audio.mp4');
console.log(result.text);
console.log(result.words); // Word-level timestamps!
```

### Apple Speech on macOS

```typescript
import { transcribe, getAvailableBackends } from 'local-transcribe';

const backends = getAvailableBackends();
const appleAvailable = backends.find(b => b.name === 'apple')?.available;

if (appleAvailable) {
  // No download needed, uses built-in models
  const result = await transcribe('./audio.m4a', { backend: 'apple' });
  console.log(result.text);
}
```

### With Progress Callback

```typescript
import { transcribe } from 'local-transcribe';

const result = await transcribe('./long-recording.wav', {
  language: 'de',
  onProgress: (partial) => {
    if (!partial.isFinal) {
      process.stdout.write(`\r${partial.text}`);
    }
  }
});
```

### Integration with course-grab

```typescript
// In course-grab enrichment pipeline
import { transcribe, getAvailableBackends } from 'local-transcribe';

export async function transcribeLesson(videoPath: string): Promise<string> {
  // Extract audio from video
  const audioPath = await extractAudio(videoPath);

  // Transcribe with best available backend
  const result = await transcribe(audioPath, {
    language: 'de',
  });

  return result.text;
}
```

## Limitations

### Per Backend

| Backend | Limitations |
|---------|-------------|
| Apple | macOS only, permissions required |
| Parakeet | 25 EU languages only, ~600MB download |
| Canary | 25 EU languages only, ~1.2GB download |
| Whisper | Slower than Parakeet, larger models |

### General

1. **Audio format** - ffmpeg required for format conversion
2. **Long audio** - Files >24min may need chunking (Parakeet handles 24min in one pass)
3. **Memory** - Large models need sufficient RAM (~2-4GB for inference)

## Future Enhancements

- [ ] Streaming transcription with partial results
- [ ] Speaker diarization
- [ ] Translation support (Canary: transcribe German → English text)
- [ ] Custom vocabulary/context hints
- [ ] Pre-built binaries via prebuild (avoid compile step)
- [ ] WebGPU backend for browser support
- [ ] Batch processing for multiple files

## Dependencies

```json
{
  "dependencies": {
    "onnxruntime-node": "^1.18.0",
    "node-addon-api": "^7.0.0"
  },
  "optionalDependencies": {
    "nodejs-whisper": "^0.2.0"
  },
  "devDependencies": {
    "node-gyp": "^10.0.0"
  }
}
```

## Alternatives Considered

### CLI Wrapper Only (Rejected)
Simpler but adds process spawn overhead and complicates error handling/progress.

### Separate Packages per Backend (Rejected)
Would complicate installation and selection logic for users.

### Python Bridge (Rejected)
Would require Python runtime, adds complexity for Node.js users.

## Open Questions

1. Should translation be a separate function or option in `transcribe()`?
2. Pre-built binaries for common Node versions + platforms?
3. Support for real-time microphone input (streaming)?
4. WebAssembly build for browser environments?

## References

- [NVIDIA Parakeet/Canary Models](https://blogs.nvidia.com/blog/speech-ai-dataset-models/)
- [ONNX Runtime Node.js](https://onnxruntime.ai/docs/get-started/with-javascript/node.html)
- [Apple Speech Framework](https://developer.apple.com/documentation/speech)
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp)
- [Node-API Documentation](https://nodejs.org/api/n-api.html)

---

**Status:** Draft
**Author:** course-grab team
**Created:** 2025-12-16
**Updated:** 2025-12-16 - Added multi-backend support (Parakeet v3, Canary, Whisper)

