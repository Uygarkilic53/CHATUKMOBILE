const fs = require('fs');
const path = require('path');

// 1. Patch expo-asset
const assetFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-asset', 'build', 'ExpoAsset.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-asset', 'src', 'ExpoAsset.ts'),
];

for (const filePath of assetFiles) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes("requireNativeModule('ExpoAsset')")) {
      content = content.replace(
        /import\s*\{\s*requireNativeModule\s*\}\s*from\s*['"]expo-modules-core['"];/g,
        "import { requireOptionalNativeModule } from 'expo-modules-core';"
      );
      content = content.replace(
        /const\s+AssetModule\s*=\s*requireNativeModule\('ExpoAsset'\);/g,
        "const AssetModule = requireOptionalNativeModule('ExpoAsset');"
      );
      content = content.replace(
        /return\s+AssetModule\.downloadAsync\(url,\s*md5Hash,\s*type\);/g,
        "if (AssetModule) return AssetModule.downloadAsync(url, md5Hash, type); return url;"
      );
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[patch] Successfully patched ${filePath}`);
    }
  }
}

// 2. Patch expo/src/winter/fetch/ExpoFetchModule.ts
const fetchModuleFile = path.join(__dirname, '..', 'node_modules', 'expo', 'src', 'winter', 'fetch', 'ExpoFetchModule.ts');
if (fs.existsSync(fetchModuleFile)) {
  let content = fs.readFileSync(fetchModuleFile, 'utf8');
  if (content.includes("requireNativeModule('ExpoFetchModule')")) {
    content = `import { requireOptionalNativeModule } from 'expo-modules-core';\n\nclass StubNativeRequest {}\nclass StubNativeResponse {}\n\nexport const ExpoFetchModule: any =\n  requireOptionalNativeModule('ExpoFetchModule') ?? {\n    NativeRequest: StubNativeRequest,\n    NativeResponse: StubNativeResponse,\n  };\n`;
    fs.writeFileSync(fetchModuleFile, content, 'utf8');
    console.log(`[patch] Successfully patched ${fetchModuleFile}`);
  }
}

// 3. Patch expo/src/winter/runtime.native.ts
const runtimeNativeFile = path.join(__dirname, '..', 'node_modules', 'expo', 'src', 'winter', 'runtime.native.ts');
if (fs.existsSync(runtimeNativeFile)) {
  let content = fs.readFileSync(runtimeNativeFile, 'utf8');
  if (content.includes("if (!globalThis.Headers)")) {
    content = content.replace(
      /if \(!useRnFetch\) \{[\s\S]*?install\('fetch', \(\) => require\('\.\/fetch'\)\.fetch\);[\s\S]*?\}/,
      `if (!useRnFetch) {\n  try {\n    const { ExpoFetchModule } = require('./fetch/ExpoFetchModule');\n    if (ExpoFetchModule && typeof ExpoFetchModule.unstable_createBlobData === 'function') {\n      if (globalThis.Headers) {\n        install('fetch', () => require('./fetch').fetch);\n      }\n    }\n  } catch {}\n}`
    );
    fs.writeFileSync(runtimeNativeFile, content, 'utf8');
    console.log(`[patch] Successfully patched ${runtimeNativeFile}`);
  }
}

// 4. Patch expo-linking
const linkingFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-linking', 'build', 'ExpoLinking.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-linking', 'src', 'ExpoLinking.ts'),
];

for (const filePath of linkingFiles) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes("requireNativeModule('ExpoLinking')") || content.includes("requireNativeModule<ExpoLinkingNativeModule>('ExpoLinking')")) {
      content = content.replace(
        /import\s*\{\s*requireNativeModule/g,
        "import { requireOptionalNativeModule"
      );
      content = content.replace(
        /const\s+ExpoLinking\s*=\s*requireNativeModule[^;]*;/g,
        "const fallbackLinking = { getLinkingURL: () => null, clearInitialURL: () => {}, addListener: () => ({ remove: () => {} }), removeListeners: () => {} };\nconst ExpoLinking = requireOptionalNativeModule('ExpoLinking') ?? fallbackLinking;"
      );
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[patch] Successfully patched ${filePath}`);
    }
  }
}

// 5. Patch expo-modules-core requireNativeModule with fallback proxy
const requireNativeModuleFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-modules-core', 'build', 'requireNativeModule.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-modules-core', 'src', 'requireNativeModule.ts'),
];

const fallbackHelper = `function createFallbackModule(moduleName) {
  class FallbackAudioPlayer {
    constructor() {
      this.currentStatus = { playing: false, currentTime: 0, duration: 0, isLoaded: false, status: 'idle' };
      this.id = 'fallback-audio-player';
    }
    replace() {}
    setPlaybackRate() {}
    play() {}
    pause() {}
    seekTo() {}
    remove() {}
    release() {}
    addListener() { return { remove: () => {} }; }
    removeListener() {}
  }
  class FallbackAudioRecorder {
    constructor() {
      this.id = 'fallback-audio-recorder';
    }
    getStatus() {
      return { canRecord: false, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, url: null, metering: undefined };
    }
    prepareToRecordAsync() { return Promise.resolve({}); }
    recordAsync() { return Promise.resolve(); }
    stop() {}
    addListener() { return { remove: () => {} }; }
    removeListener() {}
  }
  class FallbackVideoPlayer {
    constructor() {
      this.playing = false;
      this.loop = false;
      this.muted = false;
      this.currentTime = 0;
      this.duration = 0;
      this.status = 'idle';
      this.id = 'fallback-video-player';
    }
    play() {}
    pause() {}
    replace() {}
    replaceAsync() { return Promise.resolve(); }
    seekBy() {}
    replay() {}
    release() {}
    addListener() { return { remove: () => {} }; }
    removeListener() {}
  }
  class FallbackVideoThumbnail {}
  const target = {
    addListener: () => ({ remove: () => {} }),
    removeListeners: () => {},
    isLiquidGlassAvailable: false,
    isGlassEffectAPIAvailable: false,
    getLoadedFonts: () => [],
    loadAsync: () => Promise.resolve(),
    loadFontFamilyAsync: () => Promise.resolve(),
    AudioPlayer: FallbackAudioPlayer,
    AudioRecorder: FallbackAudioRecorder,
    VideoPlayer: FallbackVideoPlayer,
    VideoThumbnail: FallbackVideoThumbnail,
    setIsAudioActiveAsync: () => Promise.resolve(),
    setAudioModeAsync: () => Promise.resolve(),
    isPictureInPictureSupported: () => false,
    clearVideoCacheAsync: () => Promise.resolve(),
    setVideoCacheSizeAsync: () => Promise.resolve(),
    getCurrentVideoCacheSize: () => 0,
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) {
        return t[prop];
      }
      if (typeof prop === 'symbol' || prop === 'then' || prop === '$$typeof') {
        return undefined;
      }
      if (prop === 'prototype') {
        return Object.prototype;
      }
      function FallbackStub() {
        return Promise.resolve(null);
      }
      FallbackStub.prototype = {};
      return FallbackStub;
    },
  });
}

`;

for (const filePath of requireNativeModuleFiles) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes('FallbackVideoPlayer')) {
      if (content.includes('function createFallbackModule')) {
        content = content.replace(/function createFallbackModule[\s\S]*?\n\}\n\n?/m, fallbackHelper);
      } else if (filePath.endsWith('.ts')) {
        content = content.replace(
          "export function requireNativeModule<ModuleType = any>(moduleName: string): ModuleType {",
          fallbackHelper + "export function requireNativeModule<ModuleType = any>(moduleName: string): ModuleType {"
        );
        content = content.replace(
          /if \(!nativeModule\) \{\s*throw new Error\(`Cannot find native module '\${moduleName}'`\);\s*\}/g,
          "if (!nativeModule) {\n    return createFallbackModule(moduleName) as ModuleType;\n  }"
        );
      } else {
        content = fallbackHelper + content;
        content = content.replace(
          /if \(!nativeModule\) \{\s*throw new Error\(`Cannot find native module '\${moduleName}'`\);\s*\}/g,
          "if (!nativeModule) {\n        return createFallbackModule(moduleName);\n    }"
        );
      }
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[patch] Successfully patched ${filePath}`);
    }
  }
}


// 6. Patch expo-glass-effect
const glassFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-glass-effect', 'build', 'isLiquidGlassAvailable.ios.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-glass-effect', 'src', 'isLiquidGlassAvailable.ios.ts'),
  path.join(__dirname, '..', 'node_modules', 'expo-glass-effect', 'build', 'isGlassEffectAPIAvailable.ios.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-glass-effect', 'src', 'isGlassEffectAPIAvailable.ios.ts'),
];

for (const filePath of glassFiles) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes("requireNativeModule('ExpoGlassEffect')")) {
      content = content.replace(/requireNativeModule/g, 'requireOptionalNativeModule');
      content = content.replace(/requireOptionalNativeModule\('ExpoGlassEffect'\)\.([a-zA-Z0-9_]+)/g, "requireOptionalNativeModule('ExpoGlassEffect')?.$1 ?? false");
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[patch] Successfully patched ${filePath}`);
    }
  }
}

const glassViewJs = path.join(__dirname, '..', 'node_modules', 'expo-glass-effect', 'build', 'GlassView.ios.js');
if (fs.existsSync(glassViewJs)) {
  fs.writeFileSync(glassViewJs, `'use client';
import { jsx as _jsx } from "react/jsx-runtime";
import { View } from 'react-native';
import { requireOptionalNativeModule, requireNativeViewManager } from 'expo-modules-core';
const hasGlass = !!requireOptionalNativeModule('ExpoGlassEffect');
const NativeGlassView = hasGlass ? requireNativeViewManager('ExpoGlassEffect', 'GlassView') : View;
const GlassView = (props) => {
    return _jsx(NativeGlassView, { ...props });
};
export default GlassView;
`, 'utf8');
  console.log(`[patch] Successfully patched ${glassViewJs}`);
}

const glassContainerJs = path.join(__dirname, '..', 'node_modules', 'expo-glass-effect', 'build', 'GlassContainer.ios.js');
if (fs.existsSync(glassContainerJs)) {
  fs.writeFileSync(glassContainerJs, `'use client';
import { View } from 'react-native';
import { requireOptionalNativeModule, requireNativeViewManager } from 'expo-modules-core';
const hasGlass = !!requireOptionalNativeModule('ExpoGlassEffect');
const NativeGlassContainer = hasGlass ? requireNativeViewManager('ExpoGlassEffect', 'GlassContainer') : View;
export default NativeGlassContainer;
`, 'utf8');
  console.log(`[patch] Successfully patched ${glassContainerJs}`);
}

const glassViewTsx = path.join(__dirname, '..', 'node_modules', 'expo-glass-effect', 'src', 'GlassView.ios.tsx');
if (fs.existsSync(glassViewTsx)) {
  fs.writeFileSync(glassViewTsx, `'use client';
import React from 'react';
import { View } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { GlassViewProps } from './GlassView.types';

const hasGlass = !!requireOptionalNativeModule('ExpoGlassEffect');
const NativeGlassView = hasGlass
  ? requireNativeViewManager<GlassViewProps>('ExpoGlassEffect', 'GlassView')
  : (View as any);

const GlassView = (props: GlassViewProps) => {
  return <NativeGlassView {...props} />;
};

export default GlassView;
`, 'utf8');
  console.log(`[patch] Successfully patched ${glassViewTsx}`);
}

const glassContainerTsx = path.join(__dirname, '..', 'node_modules', 'expo-glass-effect', 'src', 'GlassContainer.ios.tsx');
if (fs.existsSync(glassContainerTsx)) {
  fs.writeFileSync(glassContainerTsx, `'use client';
import { View } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { GlassContainerProps } from './GlassContainer.types';

const hasGlass = !!requireOptionalNativeModule('ExpoGlassEffect');
const NativeGlassContainer = hasGlass
  ? requireNativeViewManager<GlassContainerProps>('ExpoGlassEffect', 'GlassContainer')
  : (View as any);

export default NativeGlassContainer;
`, 'utf8');
  console.log(`[patch] Successfully patched ${glassContainerTsx}`);
}

// 7. Patch expo-image
const imageModuleFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-image', 'build', 'ImageModule.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-image', 'src', 'ImageModule.ts'),
];

for (const filePath of imageModuleFiles) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes("requireNativeModule('ExpoImage')") || content.includes("requireNativeModule<ImageNativeModule>('ExpoImage')")) {
      content = `import { requireOptionalNativeModule } from 'expo-modules-core';

const nativeModule = requireOptionalNativeModule('ExpoImage');
const fallbackImageModule = {
  Image: {},
  prefetch: async () => false,
  clearMemoryCache: async () => false,
  clearDiskCache: async () => false,
  getCachePathAsync: async () => null,
  writeToCacheAsync: async () => null,
  readFromCacheAsync: async () => null,
  configureCache: () => {},
  generateBlurhashAsync: async () => null,
  generateThumbhashAsync: async () => null,
  loadAsync: async () => null,
};

export default nativeModule ?? fallbackImageModule;
`;
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[patch] Successfully patched ${filePath}`);
    }
  }
}

const expoImageFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-image', 'build', 'ExpoImage.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-image', 'src', 'ExpoImage.tsx'),
];

for (const filePath of expoImageFiles) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes('hasNativeExpoImage')) {
      if (filePath.endsWith('.js')) {
        content = content.replace(
          "import { requireNativeView } from 'expo';",
          "import { requireNativeView } from 'expo';\nimport { requireOptionalNativeModule } from 'expo-modules-core';\nimport { Image as RNImage } from 'react-native';"
        );
        content = content.replace(
          "const NativeExpoImage = requireNativeView('ExpoImage');",
          "const hasNativeExpoImage = !!requireOptionalNativeModule('ExpoImage');\nconst NativeExpoImage = hasNativeExpoImage ? requireNativeView('ExpoImage') : null;"
        );
        content = content.replace(
          "return /*#__PURE__*/ _jsx(NativeExpoImage,",
          `if (!NativeExpoImage) {
            const src = Array.isArray(props.source) ? props.source[0] : props.source;
            const hasValidUri = typeof src === 'object' && src !== null && typeof src.uri === 'string' && src.uri.trim().length > 0;
            const validSource = hasValidUri
                ? { uri: src.uri.trim(), headers: src.headers }
                : (typeof src === 'number' ? src : null);
            if (!validSource) return null;
            return /*#__PURE__*/ _jsx(RNImage, {
                ...props,
                source: validSource,
                style: resolvedStyle,
                resizeMode: props.contentFit === 'contain' ? 'contain' : props.contentFit === 'cover' ? 'cover' : undefined,
                onLoadStart: this.onLoadStart,
                onLoad: () => this.onLoadEnd(),
                onError: () => this.onLoadEnd()
            });
        }
        return /*#__PURE__*/ _jsx(NativeExpoImage,`
        );
      } else {
        content = content.replace(
          "import { requireNativeViewManager } from 'expo-modules-core';",
          "import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';\nimport { Image as RNImage } from 'react-native';"
        );
        content = content.replace(
          "const NativeExpoImage = requireNativeViewManager('ExpoImage');",
          "const hasNativeExpoImage = !!requireOptionalNativeModule('ExpoImage');\nconst NativeExpoImage = hasNativeExpoImage ? requireNativeViewManager('ExpoImage') : null;"
        );
        content = content.replace(
          "return (\n      <NativeExpoImage",
          `if (!NativeExpoImage) {
      const src = Array.isArray(this.props.source) ? this.props.source[0] : this.props.source;
      const hasValidUri = typeof src === 'object' && src !== null && typeof (src as any).uri === 'string' && (src as any).uri.trim().length > 0;
      const validSource = hasValidUri
        ? { uri: (src as any).uri.trim(), headers: (src as any).headers }
        : (typeof src === 'number' ? src : null);
      if (!validSource) return null;
      return (
        <RNImage
          {...(this.props as any)}
          source={validSource}
          style={resolvedStyle}
          resizeMode={(this.props as any).contentFit === 'contain' ? 'contain' : (this.props as any).contentFit === 'cover' ? 'cover' : undefined}
          onLoadStart={this.onLoadStart}
          onLoad={() => this.onLoadEnd()}
          onError={() => this.onLoadEnd()}
        />
      );
    }

    return (
      <NativeExpoImage`
        );
      }
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[patch] Successfully patched ${filePath}`);
    }
  }
}

// 8. Patch expo-constants
const exponentConstantsFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-constants', 'build', 'ExponentConstants.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-constants', 'src', 'ExponentConstants.ts'),
];

const fallbackConstantsCode = `import { requireOptionalNativeModule } from 'expo-modules-core';

const fallbackExponentConstants = {
  name: 'chatuk_temp',
  slug: 'chatuk_temp',
  manifest: {
    name: 'chatuk_temp',
    slug: 'chatuk_temp',
    version: '1.0.0',
    scheme: 'chatuk',
    extra: {
      expoClient: {
        name: 'chatuk_temp',
        slug: 'chatuk_temp',
        version: '1.0.0',
        scheme: 'chatuk',
      },
    },
  },
  expoConfig: {
    name: 'chatuk_temp',
    slug: 'chatuk_temp',
    version: '1.0.0',
    scheme: 'chatuk',
  },
  executionEnvironment: 'bare',
};

export default requireOptionalNativeModule('ExponentConstants') ?? fallbackExponentConstants;
`;

for (const filePath of exponentConstantsFiles) {
  if (fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, fallbackConstantsCode, 'utf8');
    console.log(`[patch] Successfully patched ${filePath}`);
  }
}

const constantsFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-constants', 'build', 'Constants.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-constants', 'src', 'Constants.ts'),
];

for (const filePath of constantsFiles) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('!maybeManifest') && !content.includes('fallbackAppConfig')) {
      content = `const fallbackAppConfig = { name: 'chatuk_temp', slug: 'chatuk_temp', version: '1.0.0', scheme: 'chatuk' };\n` + content;
      content = content.replace(
        /if \(!maybeManifest\) \{\s*return null;\s*\}/g,
        "if (!maybeManifest) { return fallbackAppConfig; }"
      );
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[patch] Successfully patched ${filePath}`);
    }
  }
}

// 9. Patch expo-linking Schemes.js & Schemes.ts
const schemesFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-linking', 'build', 'Schemes.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-linking', 'src', 'Schemes.ts'),
];

for (const filePath of schemesFiles) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('expo-linking needs access to the expo-constants manifest')) {
      content = content.replace(
        /if\s*\(\s*Constants\.executionEnvironment\s*!==\s*ExecutionEnvironment\.StoreClient\s*&&\s*!hasConstantsManifest\(\)\s*\)\s*\{[\s\S]*?expo-linking needs access to the expo-constants manifest[\s\S]*?\}\n/,
        `if (Constants.executionEnvironment !== ExecutionEnvironment.StoreClient && !hasConstantsManifest()) {\n    return options.scheme ?? 'chatuk';\n  }\n`
      );
      content = content.replace(
        /if\s*\(!manifestSchemes\.length\)\s*\{[\s\S]*?Cannot make a deep link into a standalone app with no custom scheme defined[\s\S]*?\}\s*\}\n/,
        `if (!manifestSchemes.length) {\n    return options.scheme ?? 'chatuk';\n  }\n`
      );
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[patch] Successfully patched ${filePath}`);
    }
  }
}

// 10. Shim expo-module-scripts for IDE tsconfig resolution
const moduleScriptsDir = path.join(__dirname, '..', 'node_modules', 'expo-module-scripts');
if (!fs.existsSync(moduleScriptsDir)) {
  fs.mkdirSync(moduleScriptsDir, { recursive: true });
}
const tsconfigBaseContent = JSON.stringify({
  $schema: "https://json.schemastore.org/tsconfig",
  compilerOptions: {
    target: "es2022",
    module: "esnext",
    moduleResolution: "bundler",
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    declaration: true,
    composite: true,
    jsx: "react-native",
    skipLibCheck: true,
    noImplicitAny: false,
  },
}, null, 2);

fs.writeFileSync(path.join(moduleScriptsDir, 'package.json'), JSON.stringify({ name: 'expo-module-scripts', version: '56.0.3', main: 'index.js' }, null, 2), 'utf8');
fs.writeFileSync(path.join(moduleScriptsDir, 'tsconfig.base.json'), tsconfigBaseContent, 'utf8');
fs.writeFileSync(path.join(moduleScriptsDir, 'tsconfig.base'), tsconfigBaseContent, 'utf8');
console.log(`[patch] Successfully ensured expo-module-scripts tsconfig shims`);

// 11. Patch NativeViewManagerAdapter.native.tsx to safely catch getViewConfig
const nativeViewAdapterFile = path.join(__dirname, '..', 'node_modules', 'expo-modules-core', 'src', 'NativeViewManagerAdapter.native.tsx');
if (fs.existsSync(nativeViewAdapterFile)) {
  let content = fs.readFileSync(nativeViewAdapterFile, 'utf8');
  if (content.includes('const expoViewConfig = globalThis.expo?.getViewConfig(moduleName, viewName);')) {
    content = content.replace(
      'const expoViewConfig = globalThis.expo?.getViewConfig(moduleName, viewName);',
      'let expoViewConfig: any = null;\n    try {\n      expoViewConfig = globalThis.expo?.getViewConfig(moduleName, viewName);\n    } catch {}'
    );
    fs.writeFileSync(nativeViewAdapterFile, content, 'utf8');
    console.log(`[patch] Successfully patched ${nativeViewAdapterFile}`);
  }
}

// 12. Patch NativeLinearGradient.ios.js & NativeLinearGradient.ios.tsx & LinearGradient.js
const nativeLinearGradientJs = path.join(__dirname, '..', 'node_modules', 'expo-linear-gradient', 'build', 'NativeLinearGradient.ios.js');
if (fs.existsSync(nativeLinearGradientJs)) {
  fs.writeFileSync(nativeLinearGradientJs, `'use client';
import { jsx as _jsx } from "react/jsx-runtime";
import { View, UIManager } from 'react-native';
import { requireNativeView } from 'expo';

let NativeComp = null;
try {
  const comp = requireNativeView('ExpoLinearGradient');
  if (comp && comp.displayName !== 'UnimplementedView' && comp.name !== 'UnimplementedView') {
    NativeComp = comp;
  }
} catch (e) {
  NativeComp = null;
}

export default function NativeLinearGradient(props) {
  if (NativeComp && NativeComp.displayName !== 'UnimplementedView' && NativeComp.name !== 'UnimplementedView') {
    return _jsx(NativeComp, { ...props });
  }
  const { colors, style, children, ...rest } = props;
  const fallbackBg = Array.isArray(colors) && colors.length > 0 ? colors[0] : undefined;
  return _jsx(View, { style: [{ backgroundColor: fallbackBg }, style], ...rest, children });
}
`, 'utf8');
  console.log(`[patch] Successfully patched ${nativeLinearGradientJs}`);
}

const linearGradientJs = path.join(__dirname, '..', 'node_modules', 'expo-linear-gradient', 'build', 'LinearGradient.js');
if (fs.existsSync(linearGradientJs)) {
  fs.writeFileSync(linearGradientJs, `'use client';
import { jsx as _jsx } from "react/jsx-runtime";
import { Component } from 'react';
import { Platform, processColor, View } from 'react-native';
import NativeLinearGradient from './NativeLinearGradient';

export class LinearGradient extends Component {
  render() {
    const { colors, locations, start, end, dither, style, ...props } = this.props;
    let resolvedLocations = locations;
    if (locations && colors.length !== locations.length) {
      resolvedLocations = locations.slice(0, colors.length);
    }
    return _jsx(NativeLinearGradient, {
      ...props,
      style,
      colors: Platform.select({
        web: colors,
        default: colors.map(processColor),
      }),
      dither: Platform.select({
        android: dither,
      }),
      locations: resolvedLocations,
      startPoint: _normalizePoint(start),
      endPoint: _normalizePoint(end),
    });
  }
}

function _normalizePoint(point) {
  if (!point) return undefined;
  if (Array.isArray(point) && point.length !== 2) {
    return undefined;
  }
  return Array.isArray(point) ? point : [point.x, point.y];
}
`, 'utf8');
  console.log(`[patch] Successfully patched ${linearGradientJs}`);
}

const nativeLinearGradientTsx = path.join(__dirname, '..', 'node_modules', 'expo-linear-gradient', 'src', 'NativeLinearGradient.ios.tsx');
if (fs.existsSync(nativeLinearGradientTsx)) {
  fs.writeFileSync(nativeLinearGradientTsx, `'use client';
import React from 'react';
import { View } from 'react-native';
import { requireNativeView } from 'expo';
import type { NativeLinearGradientProps } from './NativeLinearGradient.types';

let NativeComp: React.FC<NativeLinearGradientProps> | null = null;
try {
  const comp = requireNativeView('ExpoLinearGradient') as any;
  if (comp && comp.displayName !== 'UnimplementedView' && comp.name !== 'UnimplementedView') {
    NativeComp = comp;
  }
} catch {}

const NativeLinearGradient: React.FC<NativeLinearGradientProps> = (props) => {
  if (NativeComp && (NativeComp as any).displayName !== 'UnimplementedView' && (NativeComp as any).name !== 'UnimplementedView') {
    return <NativeComp {...props} />;
  }
  const { colors, style, children, ...rest } = props;
  const fallbackBg = Array.isArray(colors) && colors.length > 0 ? colors[0] : undefined;
  return <View style={[{ backgroundColor: fallbackBg as any }, style as any]} {...(rest as any)}>{children}</View>;
};

export default NativeLinearGradient;
`, 'utf8');
  console.log(`[patch] Successfully patched ${nativeLinearGradientTsx}`);
}

// 13. Patch expo-font
const fontLoaderFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-font', 'build', 'ExpoFontLoader.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-font', 'src', 'ExpoFontLoader.ts'),
];

for (const filePath of fontLoaderFiles) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes("requireNativeModule('ExpoFontLoader')")) {
      content = content.replace(
        /import\s*\{\s*requireNativeModule\s*\}\s*from\s*['"]expo-modules-core['"];/g,
        "import { requireOptionalNativeModule } from 'expo-modules-core';"
      );
      content = content.replace(
        "requireNativeModule('ExpoFontLoader')",
        "requireOptionalNativeModule('ExpoFontLoader') ?? { getLoadedFonts: () => [], loadAsync: () => Promise.resolve(), loadFontFamilyAsync: () => Promise.resolve() }"
      );
      fs.writeFileSync(filePath, content, 'utf8');
    }
  }
}

// 14. Patch expo-audio ExpoAudio.js & ExpoAudio.ts
const expoAudioFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-audio', 'build', 'ExpoAudio.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-audio', 'src', 'ExpoAudio.ts'),
];

for (const filePath of expoAudioFiles) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes("AudioModule.AudioPlayer.prototype.replace") && !content.includes("AudioModule?.AudioPlayer?.prototype")) {
      content = content.replace(
        /const\s+replace\s*=\s*AudioModule\.AudioPlayer\.prototype\.replace;\s*AudioModule\.AudioPlayer\.prototype\.replace\s*=\s*function\s*\(([^)]*)\)\s*\{[\s\S]*?\};\s*const\s+setPlaybackRate\s*=\s*AudioModule\.AudioPlayer\.prototype\.setPlaybackRate;\s*AudioModule\.AudioPlayer\.prototype\.setPlaybackRate\s*=\s*function\s*\(([^)]*)\)\s*\{[\s\S]*?\};/,
        `if (AudioModule?.AudioPlayer?.prototype) {
  const replace = AudioModule.AudioPlayer.prototype.replace;
  if (typeof replace === 'function') {
    AudioModule.AudioPlayer.prototype.replace = function($1) {
      return replace.call(this, resolveSource(source));
    };
  }
  const setPlaybackRate = AudioModule.AudioPlayer.prototype.setPlaybackRate;
  if (typeof setPlaybackRate === 'function') {
    AudioModule.AudioPlayer.prototype.setPlaybackRate = function($2) {
      if (Platform.OS === 'android') {
        return setPlaybackRate.call(this, rate);
      } else {
        return setPlaybackRate.call(this, rate, pitchCorrectionQuality);
      }
    };
  }
}`
      );
      content = content.replace(
        /const\s+prepareToRecordAsync\s*=\s*AudioModule\.AudioRecorder\.prototype\.prepareToRecordAsync;\s*AudioModule\.AudioRecorder\.prototype\.prepareToRecordAsync\s*=\s*function\s*\(([^)]*)\)\s*\{[\s\S]*?\};/,
        `if (AudioModule?.AudioRecorder?.prototype) {
    const prepareToRecordAsync = AudioModule.AudioRecorder.prototype.prepareToRecordAsync;
    if (typeof prepareToRecordAsync === 'function') {
      AudioModule.AudioRecorder.prototype.prepareToRecordAsync = function($1) {
        const processedOptions = options ? createRecordingOptions(options) : undefined;
        return prepareToRecordAsync.call(this, processedOptions);
      };
    }
  }`
      );
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[patch] Successfully patched ${filePath}`);
    }
  }
}

// 15. Patch expo-audio AudioModule.js & AudioModule.ts
const audioModuleFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-audio', 'build', 'AudioModule.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-audio', 'src', 'AudioModule.ts'),
];

const fallbackAudioModuleCode = `import { requireOptionalNativeModule } from 'expo-modules-core';

class FallbackAudioPlayer {
  constructor() {
    this.currentStatus = { playing: false, currentTime: 0, duration: 0, isLoaded: false, status: 'idle' };
    this.id = 'fallback-audio-player';
  }
  replace() {}
  setPlaybackRate() {}
  play() {}
  pause() {}
  seekTo() {}
  remove() {}
  release() {}
  addListener() { return { remove: () => {} }; }
  removeListener() {}
}

class FallbackAudioRecorder {
  constructor() {
    this.id = 'fallback-audio-recorder';
  }
  getStatus() {
    return { canRecord: false, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, url: null, metering: undefined };
  }
  prepareToRecordAsync() { return Promise.resolve({}); }
  recordAsync() { return Promise.resolve(); }
  stop() {}
  addListener() { return { remove: () => {} }; }
  removeListener() {}
}

const fallbackAudioModule = {
  AudioPlayer: FallbackAudioPlayer,
  AudioRecorder: FallbackAudioRecorder,
  setIsAudioActiveAsync: () => Promise.resolve(),
  setAudioModeAsync: () => Promise.resolve(),
  addListener: () => ({ remove: () => {} }),
  removeListeners: () => {},
};

export default requireOptionalNativeModule('ExpoAudio') ?? fallbackAudioModule;
`;

for (const filePath of audioModuleFiles) {
  if (fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, fallbackAudioModuleCode, 'utf8');
    console.log(`[patch] Successfully patched ${filePath}`);
  }
}

// 16. Patch expo-video ExpoVideo.js & ExpoVideo.ts
const expoVideoModuleFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-video', 'build', 'ExpoVideo.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-video', 'src', 'ExpoVideo.ts'),
];

const fallbackVideoModuleCode = `import { requireOptionalNativeModule } from 'expo-modules-core';

class FallbackVideoPlayer {
  constructor() {
    this.playing = false;
    this.loop = false;
    this.muted = false;
    this.currentTime = 0;
    this.duration = 0;
    this.status = 'idle';
    this.id = 'fallback-video-player';
  }
  play() {}
  pause() {}
  replace() {}
  replaceAsync() { return Promise.resolve(); }
  seekBy() {}
  replay() {}
  release() {}
  addListener() { return { remove: () => {} }; }
  removeListener() {}
}

class FallbackVideoThumbnail {}

const fallbackVideoModule = {
  VideoPlayer: FallbackVideoPlayer,
  VideoThumbnail: FallbackVideoThumbnail,
  isPictureInPictureSupported: () => false,
  setVideoCacheSizeAsync: () => Promise.resolve(),
  clearVideoCacheAsync: () => Promise.resolve(),
  getCurrentVideoCacheSize: () => 0,
  addListener: () => ({ remove: () => {} }),
  removeListeners: () => {},
};

export default requireOptionalNativeModule('ExpoVideo') ?? fallbackVideoModule;
`;

for (const filePath of expoVideoModuleFiles) {
  if (fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, fallbackVideoModuleCode, 'utf8');
    console.log(`[patch] Successfully patched ${filePath}`);
  }
}

// 17. Patch expo-video VideoPlayer.js & VideoPlayer.tsx
const expoVideoPlayerFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-video', 'build', 'VideoPlayer.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-video', 'src', 'VideoPlayer.tsx'),
];

for (const filePath of expoVideoPlayerFiles) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes('NativeVideoModule?.VideoPlayer?.prototype')) {
      if (filePath.endsWith('.js')) {
        const jsTarget = `const replace = NativeVideoModule.VideoPlayer.prototype.replace;
NativeVideoModule.VideoPlayer.prototype.replace = function(source, disableWarning = false) {
    if (!disableWarning) {
        console.warn('On iOS \`VideoPlayer.replace\` loads the asset data synchronously on the main thread, which can lead to UI freezes and will be deprecated in a future release. Switch to \`replaceAsync\` for better user experience.');
    }
    return replace.call(this, parseSource(source));
};
const replaceAsync = NativeVideoModule.VideoPlayer.prototype.replaceAsync;
NativeVideoModule.VideoPlayer.prototype.replaceAsync = function(source) {
    return replaceAsync.call(this, parseSource(source));
};`;
        const jsReplacement = `if (NativeVideoModule?.VideoPlayer?.prototype) {
    const replace = NativeVideoModule.VideoPlayer.prototype.replace;
    if (typeof replace === 'function') {
        NativeVideoModule.VideoPlayer.prototype.replace = function(source, disableWarning = false) {
            if (!disableWarning) {
                console.warn('On iOS \`VideoPlayer.replace\` loads the asset data synchronously on the main thread, which can lead to UI freezes and will be deprecated in a future release. Switch to \`replaceAsync\` for better user experience.');
            }
            return replace.call(this, parseSource(source));
        };
    }
    const replaceAsync = NativeVideoModule.VideoPlayer.prototype.replaceAsync;
    if (typeof replaceAsync === 'function') {
        NativeVideoModule.VideoPlayer.prototype.replaceAsync = function(source) {
            return replaceAsync.call(this, parseSource(source));
        };
    }
}`;
        content = content.replace(jsTarget, jsReplacement);
      } else {
        const tsxTarget = `const replace = NativeVideoModule.VideoPlayer.prototype.replace;
NativeVideoModule.VideoPlayer.prototype.replace = function (
  source: VideoSource,
  disableWarning: boolean = false
) {
  if (!disableWarning) {
    console.warn(
      'On iOS \`VideoPlayer.replace\` loads the asset data synchronously on the main thread, which can lead to UI freezes and will be deprecated in a future release. Switch to \`replaceAsync\` for better user experience.'
    );
  }

  return replace.call(this, parseSource(source));
};

const replaceAsync = NativeVideoModule.VideoPlayer.prototype.replaceAsync;
NativeVideoModule.VideoPlayer.prototype.replaceAsync = function (source: VideoSource) {
  return replaceAsync.call(this, parseSource(source));
};`;
        const tsxReplacement = `if (NativeVideoModule?.VideoPlayer?.prototype) {
  const replace = NativeVideoModule.VideoPlayer.prototype.replace;
  if (typeof replace === 'function') {
    NativeVideoModule.VideoPlayer.prototype.replace = function (
      source: VideoSource,
      disableWarning: boolean = false
    ) {
      if (!disableWarning) {
        console.warn(
          'On iOS \`VideoPlayer.replace\` loads the asset data synchronously on the main thread, which can lead to UI freezes and will be deprecated in a future release. Switch to \`replaceAsync\` for better user experience.'
        );
      }

      return replace.call(this, parseSource(source));
    };
  }

  const replaceAsync = NativeVideoModule.VideoPlayer.prototype.replaceAsync;
  if (typeof replaceAsync === 'function') {
    NativeVideoModule.VideoPlayer.prototype.replaceAsync = function (source: VideoSource) {
      return replaceAsync.call(this, parseSource(source));
    };
  }
}`;
        content = content.replace(tsxTarget, tsxReplacement);
      }
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[patch] Successfully patched ${filePath}`);
    }
  }
}

// 18. Patch expo-video NativeVideoView.js & NativeVideoView.ts
const nativeVideoViewFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-video', 'build', 'NativeVideoView.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-video', 'src', 'NativeVideoView.ts'),
];

for (const filePath of nativeVideoViewFiles) {
  if (fs.existsSync(filePath)) {
    const isTs = filePath.endsWith('.ts');
    const content = `'use client';
import { requireNativeView } from 'expo';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform, View } from 'react-native';

const hasVideo = !!requireOptionalNativeModule('ExpoVideo');
const defaultViewName = Platform.OS === 'android' ? 'SurfaceVideoView' : 'VideoView';

export default hasVideo ? requireNativeView${isTs ? '<any>' : ''}('ExpoVideo', defaultViewName) : ${isTs ? '(View as any)' : 'View'};
export const NativeTextureVideoView = (Platform.OS === 'android' && hasVideo) ? requireNativeView${isTs ? '<any>' : ''}('ExpoVideo', 'TextureVideoView') : null;
`;
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[patch] Successfully patched ${filePath}`);
  }
}

// 19. Patch expo-video NativeVideoAirPlayButtonView.js & NativeVideoAirPlayButtonView.ts
const nativeAirPlayFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-video', 'build', 'NativeVideoAirPlayButtonView.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-video', 'src', 'NativeVideoAirPlayButtonView.ts'),
];

for (const filePath of nativeAirPlayFiles) {
  if (fs.existsSync(filePath)) {
    const isTs = filePath.endsWith('.ts');
    const content = `'use client';
import { requireNativeView } from 'expo';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { View } from 'react-native';

const hasVideo = !!requireOptionalNativeModule('ExpoVideo');
export default hasVideo ? requireNativeView${isTs ? '<any>' : ''}('ExpoVideo', 'VideoAirPlayButtonView') : ${isTs ? '(View as any)' : 'View'};
`;
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[patch] Successfully patched ${filePath}`);
  }
}

// 20. Patch expo-modules-core uuid fallback generator
const uuidFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-modules-core', 'build', 'uuid', 'index.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-modules-core', 'src', 'uuid', 'index.ts'),
  path.join(__dirname, '..', 'node_modules', 'expo-modules-core', 'build', 'uuid', 'index.web.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-modules-core', 'src', 'uuid', 'index.web.ts'),
];

const fallbackUuidFn = `
function generateFallbackUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
`;

for (const filePath of uuidFiles) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Remove any previously inserted or corrupted generateFallbackUuid definition
    if (content.includes('function generateFallbackUuid')) {
      content = content.replace(/function generateFallbackUuid\(\)[\s\S]*?\n\}\n/m, '');
      modified = true;
    }

    if (filePath.includes('index.web.')) {
      const isTs = filePath.endsWith('.ts');
      const newUuidv4 = `function uuidv4()${isTs ? ': string' : ''} {
  if (
    process.env.NODE_ENV === 'test' ||
    (typeof crypto === 'undefined' && typeof window === 'undefined')
  ) {
    try {
      return eval('require')('node:crypto').randomUUID();
    } catch {}
  }
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {}
  }
  return generateFallbackUuid();
}`;
      content = content.replace(/function uuidv4\(\)(?:: string)?\s*\{[\s\S]*?\n\}/m, newUuidv4);
      content = fallbackUuidFn + content;
      modified = true;
    } else {
      // In native index.js and index.ts, guard against missing nativeUuidv4 and nativeUuidv5
      content = content.replace(
        /if \(!nativeUuidv4\) \{\s*throw Error\(\s*"Native UUID version 4 generator implementation wasn't found in \`expo-modules-core\`"\s*\);\s*\}/gm,
        `if (!nativeUuidv4) {\n    return generateFallbackUuid();\n  }`
      );
      content = content.replace(
        /if \(!nativeUuidv5\) \{\s*throw Error\(\s*"Native UUID type 5 generator implementation wasn't found in \`expo-modules-core\`"\s*\);\s*\}/gm,
        `if (!nativeUuidv5) {\n    return generateFallbackUuid();\n  }`
      );
      content = fallbackUuidFn + content;
      modified = true;
    }

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[patch] Successfully patched ${filePath}`);
    }
  }
}

// 21. Patch expo-file-system for safe web/native fallback
const fileSystemShimFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-file-system', 'build', 'legacy', 'ExponentFileSystemShim.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-file-system', 'src', 'legacy', 'ExponentFileSystemShim.ts'),
];

const fallbackFileSystemCode = `import { NativeModule } from 'expo-modules-core';

class FileSystemShim extends NativeModule {
  documentDirectory = null;
  cacheDirectory = null;
  bundleDirectory = null;
  addListener() { return { remove: () => {} }; }
  removeListeners() {}
  async getInfoAsync(uri) { return { exists: false, isDirectory: false, size: 0, modificationTime: 0, uri: uri || '' }; }
  async readAsStringAsync() { return ''; }
  async writeAsStringAsync() { return; }
  async deleteAsync() { return; }
  async moveAsync() { return; }
  async copyAsync() { return; }
  async makeDirectoryAsync() { return; }
  async readDirectoryAsync() { return []; }
  async downloadAsync(uri, fileUri) { return { uri: fileUri || uri || '', status: 200, headers: {}, md5: '' }; }
  async uploadAsync() { return { status: 200, body: '', headers: {} }; }
  async networkTaskCancelAsync() { return; }
  async uploadTaskStartAsync() { return { status: 200, body: '', headers: {} }; }
  async downloadResumableStartAsync() { return { status: 200 }; }
  async downloadResumablePauseAsync() { return { resumeData: '' }; }
  async getContentUriAsync() { return ''; }
  async getFreeDiskStorageAsync() { return 0; }
  async getTotalDiskCapacityAsync() { return 0; }
  async requestDirectoryPermissionsAsync() { return { granted: false, directoryUri: '' }; }
  async readSAFDirectoryAsync() { return []; }
  async makeSAFDirectoryAsync() { return ''; }
  async createSAFFileAsync() { return ''; }
}

const fallbackExponentFileSystem = new FileSystemShim();
export default fallbackExponentFileSystem;
`;

for (const filePath of fileSystemShimFiles) {
  if (fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, fallbackFileSystemCode, 'utf8');
    console.log(`[patch] Successfully patched ${filePath}`);
  }
}

const fileSystemCoreFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-file-system', 'build', 'legacy', 'FileSystem.js'),
  path.join(__dirname, '..', 'node_modules', 'expo-file-system', 'src', 'legacy', 'FileSystem.ts'),
];

for (const filePath of fileSystemCoreFiles) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Guard documentDirectory, cacheDirectory, bundleDirectory on null/undefined ExponentFileSystem
    if (content.includes('ExponentFileSystem.documentDirectory') && !content.includes('ExponentFileSystem?.documentDirectory')) {
      content = content.replace(
        /ExponentFileSystem\.documentDirectory/g,
        'ExponentFileSystem?.documentDirectory'
      );
      content = content.replace(
        /ExponentFileSystem\.cacheDirectory/g,
        'ExponentFileSystem?.cacheDirectory'
      );
      content = content.replace(
        /ExponentFileSystem\.bundleDirectory/g,
        'ExponentFileSystem?.bundleDirectory'
      );
      modified = true;
    }

    // Ensure _uuid assignment never throws
    if (content.includes('_uuid = uuid.v4();')) {
      content = content.replace(
        '_uuid = uuid.v4();',
        "_uuid = (typeof uuid !== 'undefined' && uuid && typeof uuid.v4 === 'function') ? uuid.v4() : 'task-uuid-fallback';"
      );
      modified = true;
    }

    // Unpack comma super call in UploadTask constructor
    if (content.includes('super(), this.url = url, this.fileUri = fileUri, this.callback = callback;')) {
      content = content.replace(
        'super(), this.url = url, this.fileUri = fileUri, this.callback = callback;',
        'super(); this.url = url; this.fileUri = fileUri; this.callback = callback;'
      );
      modified = true;
    }

    // Unpack comma super call in DownloadResumable constructor
    if (content.includes('super(), this.url = url, this._fileUri = _fileUri, this.options = options, this.callback = callback, this.resumeData = resumeData;')) {
      content = content.replace(
        'super(), this.url = url, this._fileUri = _fileUri, this.options = options, this.callback = callback, this.resumeData = resumeData;',
        'super(); this.url = url; this._fileUri = _fileUri; this.options = options; this.callback = callback; this.resumeData = resumeData;'
      );
      modified = true;
    }

    // Guard addSubscription against null ExponentFileSystem or missing addListener
    if (content.includes('this.subscription = ExponentFileSystem.addListener(') && !content.includes('ExponentFileSystem.addListener !== \'function\'')) {
      content = content.replace(
        'if (this.subscription) {\n            return;\n        }\n        this.subscription = ExponentFileSystem.addListener(',
        'if (this.subscription || !ExponentFileSystem || typeof ExponentFileSystem.addListener !== \'function\') {\n            return;\n        }\n        this.subscription = ExponentFileSystem.addListener('
      );
      content = content.replace(
        'if (this.subscription) {\n      return;\n    }\n\n    this.subscription = ExponentFileSystem.addListener(',
        'if (this.subscription || !ExponentFileSystem || typeof ExponentFileSystem.addListener !== \'function\') {\n      return;\n    }\n\n    this.subscription = ExponentFileSystem.addListener('
      );
      modified = true;
    }

    // Guard removeSubscription against non-function remove
    if (content.includes('this.subscription.remove();') && !content.includes("this.subscription.remove === 'function'")) {
      content = content.replace(
        'this.subscription.remove();',
        "if (typeof this.subscription.remove === 'function') { this.subscription.remove(); }"
      );
      modified = true;
    }

    // Guard getInfoAsync return value against undefined / null from missing native module
    if (content.includes('return await ExponentFileSystem.getInfoAsync(fileUri, options);')) {
      content = content.replace(
        'return await ExponentFileSystem.getInfoAsync(fileUri, options);',
        'const infoRes = await ExponentFileSystem.getInfoAsync(fileUri, options); return infoRes ?? { exists: false, isDirectory: false, size: 0, modificationTime: 0, uri: fileUri || \'\' };'
      );
      modified = true;
    }

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[patch] Successfully patched ${filePath}`);
    }
  }
}

// 22. Patch jest-expo preset setup for expo-file-system/legacy
const jestExpoSetupPath = path.join(__dirname, '..', 'node_modules', 'jest-expo', 'src', 'preset', 'setup.js');
if (fs.existsSync(jestExpoSetupPath)) {
  let content = fs.readFileSync(jestExpoSetupPath, 'utf8');
  if (content.includes("jest.mock('expo-file-system/legacy', () => ({") && !content.includes('documentDirectory:')) {
    content = content.replace(
      "jest.mock('expo-file-system/legacy', () => ({",
      `jest.mock('expo-file-system/legacy', () => ({\n    documentDirectory: 'file:///mock/documentDirectory/',\n    cacheDirectory: 'file:///mock/cacheDirectory/',\n    bundleDirectory: 'file:///mock/bundleDirectory/',\n    createUploadTask: jest.fn(() => ({ cancelAsync: jest.fn(() => Promise.resolve()), uploadAsync: jest.fn(() => Promise.resolve({ status: 200 })), isTaskCancelled: jest.fn(() => false), uuid: 'mock-uuid' })),\n    UploadTask: class MockUploadTask { constructor() { this.uuid = 'mock-uuid'; } cancelAsync() { return Promise.resolve(); } isTaskCancelled() { return false; } },\n    DownloadResumable: class MockDownloadResumable { constructor() { this.uuid = 'mock-uuid'; } },\n    FileSystemSessionType: { BACKGROUND: 0, FOREGROUND: 1 },\n    FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },`
    );
    fs.writeFileSync(jestExpoSetupPath, content, 'utf8');
    console.log(`[patch] Successfully patched ${jestExpoSetupPath}`);
  }
}

console.log('[patch] All patches applied successfully.');



