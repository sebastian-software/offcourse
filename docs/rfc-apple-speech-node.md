# RFC: apple-speech-node

> Native Node.js bindings for Apple's Speech Recognition Framework

## Summary

A standalone npm package providing native Node.js bindings to Apple's `Speech.framework`, enabling on-device speech-to-text transcription on macOS without external API dependencies.

## Motivation

Current options for local speech recognition in Node.js:

| Solution | Pros | Cons |
|----------|------|------|
| `nodejs-whisper` | Works everywhere | Large models (500MB+), slower |
| OpenAI Whisper API | High quality | Requires internet, costs money |
| `whisperkit-cli` | Fast on Apple Silicon | External binary, not native JS |
| **This package** | Native, fast, no deps | macOS only |

Apple's Speech.framework offers:
- **On-device processing** - No data leaves the machine
- **Optimized for Apple Silicon** - Uses Neural Engine
- **Pre-installed models** - No download required
- **Multiple languages** - 50+ languages supported
- **Free** - No API costs

## Technical Design

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     apple-speech-node                        │
├─────────────────────────────────────────────────────────────┤
│  TypeScript API                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ import { transcribe } from 'apple-speech-node';         ││
│  │                                                          ││
│  │ const result = await transcribe('audio.wav', {          ││
│  │   language: 'de-DE',                                    ││
│  │   onProgress: (partial) => console.log(partial),        ││
│  │ });                                                      ││
│  └─────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────┤
│  N-API Binding Layer (C++)                                   │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ • Async worker threads                                   ││
│  │ • Promise-based API                                      ││
│  │ • Progress callbacks via ThreadSafeFunction              ││
│  │ • Proper error handling                                  ││
│  └─────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────┤
│  Objective-C++ Implementation                                │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ • SFSpeechRecognizer                                     ││
│  │ • SFSpeechURLRecognitionRequest                          ││
│  │ • On-device recognition (requiresOnDeviceRecognition)   ││
│  └─────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────┤
│  Apple Frameworks                                            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ Speech.fw    │ │ Foundation   │ │ AVFoundation (audio) │ │
│  └──────────────┘ └──────────────┘ └──────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Project Structure

```
apple-speech-node/
├── package.json
├── tsconfig.json
├── binding.gyp              # Node-gyp build config
├── src/
│   ├── index.ts             # TypeScript API
│   ├── types.ts             # Type definitions
│   └── native/
│       ├── transcribe.mm    # Objective-C++ implementation
│       ├── transcribe.h     # Header
│       └── binding.cpp      # N-API bindings
├── lib/                     # Compiled JS output
├── build/                   # Native addon output (.node)
├── scripts/
│   └── postinstall.js       # Platform check
└── test/
    ├── transcribe.test.ts
    └── fixtures/
        └── sample.wav
```

### API Design

```typescript
// Main transcription function
export function transcribe(
  audioPath: string,
  options?: TranscribeOptions
): Promise<TranscriptionResult>;

// Streaming transcription with progress
export function transcribeWithProgress(
  audioPath: string,
  options?: TranscribeOptionsWithProgress
): Promise<TranscriptionResult>;

// Check if speech recognition is available
export function isAvailable(): boolean;

// Get available languages
export function getAvailableLanguages(): Promise<string[]>;

// Types
export interface TranscribeOptions {
  language?: string;           // Default: 'en-US'
  onDeviceOnly?: boolean;      // Default: true (offline)
}

export interface TranscribeOptionsWithProgress extends TranscribeOptions {
  onProgress?: (partial: PartialResult) => void;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
  duration: number;            // Audio duration in seconds
  processingTime: number;      // Time taken to transcribe
  language: string;
}

export interface TranscriptionSegment {
  text: string;
  timestamp: number;           // Start time in seconds
  duration: number;
  confidence: number;          // 0.0 - 1.0
}

export interface PartialResult {
  text: string;
  isFinal: boolean;
}
```

### Native Implementation

```objc
// src/native/transcribe.mm

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

### TypeScript Wrapper

```typescript
// src/index.ts
import { createRequire } from 'module';
import { platform } from 'os';
import type { 
  TranscribeOptions, 
  TranscriptionResult,
  NativeBinding 
} from './types.js';

const require = createRequire(import.meta.url);

function loadNative(): NativeBinding | null {
  if (platform() !== 'darwin') {
    return null;
  }
  
  try {
    return require('../build/Release/apple_speech.node');
  } catch {
    return null;
  }
}

const native = loadNative();

export function isAvailable(): boolean {
  return native?.isAvailable() ?? false;
}

export async function transcribe(
  audioPath: string,
  options: TranscribeOptions = {}
): Promise<TranscriptionResult> {
  if (!native) {
    throw new Error('apple-speech-node is only available on macOS');
  }
  
  if (!isAvailable()) {
    throw new Error('Speech recognition is not available on this system');
  }
  
  const result = await native.transcribe(audioPath, {
    language: options.language ?? 'en-US',
    onDeviceOnly: options.onDeviceOnly ?? true,
  });
  
  return {
    text: result.text,
    segments: result.segments ?? [],
    duration: result.duration ?? 0,
    processingTime: result.processingTime ?? 0,
    language: options.language ?? 'en-US',
  };
}
```

## Requirements

### System Requirements

- **macOS 12.0+** (Monterey or later)
- **Node.js 18+**
- **Xcode Command Line Tools** (for building)

### Runtime Requirements

- User must grant microphone/speech recognition permission on first use
- For offline recognition: on-device models must be downloaded via System Settings

## Installation

```bash
npm install apple-speech-node
```

The package will:
1. Check if running on macOS (fail gracefully on other platforms)
2. Compile native addon using node-gyp
3. Link against Speech.framework

## Usage Examples

### Basic Transcription

```typescript
import { transcribe } from 'apple-speech-node';

const result = await transcribe('./recording.wav', {
  language: 'de-DE'
});

console.log(result.text);
```

### Check Availability

```typescript
import { isAvailable, transcribe } from 'apple-speech-node';

if (isAvailable()) {
  const result = await transcribe('./audio.m4a');
  console.log(result.text);
} else {
  console.log('Speech recognition not available');
  // Fallback to whisper or other provider
}
```

### Integration with Provider Pattern

```typescript
// In course-grab
import { transcribe as appleTranscribe, isAvailable } from 'apple-speech-node';
import { transcribe as whisperTranscribe } from 'nodejs-whisper';

interface TranscriptionProvider {
  name: string;
  isAvailable(): boolean;
  transcribe(audioPath: string, language: string): Promise<string>;
}

const providers: TranscriptionProvider[] = [
  {
    name: 'apple',
    isAvailable: () => isAvailable(),
    transcribe: async (path, lang) => {
      const result = await appleTranscribe(path, { language: lang });
      return result.text;
    }
  },
  {
    name: 'whisper',
    isAvailable: () => true,
    transcribe: async (path, lang) => {
      return await whisperTranscribe(path, { language: lang });
    }
  }
];

export function getProvider(): TranscriptionProvider {
  return providers.find(p => p.isAvailable()) ?? providers[providers.length - 1];
}
```

## Limitations

1. **macOS only** - Will not work on Linux/Windows
2. **Audio format** - Requires compatible audio (WAV, M4A, MP3, etc.)
3. **Language models** - Some languages require downloading on-device models
4. **Permissions** - First run requires user permission grant
5. **Audio length** - Very long audio files may need chunking

## Future Enhancements

- [ ] Streaming transcription with partial results
- [ ] Speaker diarization (macOS 15+)
- [ ] Word-level timestamps
- [ ] Confidence scores per segment
- [ ] Custom vocabulary/context hints
- [ ] Pre-built binaries via prebuild

## Alternatives Considered

### CLI Wrapper (Rejected)
Simpler but adds process spawn overhead and complicates error handling.

### FFI with koffi (Rejected)
Objective-C runtime complexity makes FFI impractical for Speech.framework.

### XPC Service (Considered)
Could be added later for sandboxed environments, but overkill for CLI tools.

## Open Questions

1. Should we support iOS via React Native bridge?
2. Pre-built binaries for common Node versions?
3. Fallback to server-based recognition when offline fails?

## References

- [Apple Speech Framework Documentation](https://developer.apple.com/documentation/speech)
- [Node-API Documentation](https://nodejs.org/api/n-api.html)
- [node-addon-api](https://github.com/nodejs/node-addon-api)

---

**Status:** Draft  
**Author:** course-grab team  
**Created:** 2025-12-16  

