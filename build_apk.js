const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = __dirname;
const TOOLCHAIN = path.join(PROJECT_ROOT, 'android-toolchain', 'android-13');
const ANDROID_JAR = path.join(TOOLCHAIN, 'android.jar');
const AAPT2 = path.join(TOOLCHAIN, 'aapt2.exe');
const ZIPALIGN = path.join(TOOLCHAIN, 'zipalign.exe');
const D8_JAR = path.join(TOOLCHAIN, 'lib', 'd8.jar');
const APKSIGNER_JAR = path.join(TOOLCHAIN, 'lib', 'apksigner.jar');

const JDK_BIN = 'C:\\Program Files\\Amazon Corretto\\jdk17.0.19_10\\bin';
const JAVAC = path.join(JDK_BIN, 'javac.exe');
const JAVA = path.join(JDK_BIN, 'java.exe');
const KEYTOOL = path.join(JDK_BIN, 'keytool.exe');

const BUILD_DIR = path.join(PROJECT_ROOT, 'android-build');
const SRC_DIR = path.join(BUILD_DIR, 'src', 'com', 'boxmusic', 'player');
const RES_DIR = path.join(BUILD_DIR, 'res');
const ASSETS_DIR = path.join(BUILD_DIR, 'assets');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'public', 'downloads');
const FINAL_APK = path.join(OUTPUT_DIR, 'Boxmusic.apk');

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'downloads') {
        copyRecursive(srcPath, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getFilesRecursively(dir, ext) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results = results.concat(getFilesRecursively(fullPath, ext));
    } else if (!ext || item.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

async function build() {
  console.log('--- 🚀 STARTING BOXMUSIC ANDROID APK BUILD (PRO ENGINE) ---');

  // 1. Prepare directories
  cleanDir(path.join(BUILD_DIR, 'work'));
  fs.mkdirSync(SRC_DIR, { recursive: true });
  fs.mkdirSync(path.join(RES_DIR, 'values'), { recursive: true });
  fs.mkdirSync(path.join(RES_DIR, 'drawable'), { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Copy app assets
  console.log('1. Copying Web App assets into APK bundle...');
  cleanDir(ASSETS_DIR);
  copyRecursive(path.join(PROJECT_ROOT, 'public'), ASSETS_DIR);

  // Copy icon to drawable
  const iconSource = path.join(PROJECT_ROOT, 'public', 'icons', 'icon-192.png');
  fs.copyFileSync(iconSource, path.join(RES_DIR, 'drawable', 'ic_launcher.png'));

  // 2. Write AndroidManifest.xml with clean package name com.boxmusic.player
  console.log('2. Writing AndroidManifest.xml (com.boxmusic.player, target 34)...');
  const manifestContent = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.boxmusic.player"
    android:versionCode="8"
    android:versionName="1.0.7">

    <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="34" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />

    <application
        android:label="@string/app_name"
        android:icon="@drawable/ic_launcher"
        android:theme="@android:style/Theme.NoTitleBar.Fullscreen"
        android:usesCleartextTraffic="true"
        android:allowBackup="true"
        android:supportsRtl="true"
        android:hardwareAccelerated="true">
        <activity
            android:name="com.boxmusic.player.MainActivity"
            android:label="@string/app_name"
            android:launchMode="singleTop"
            android:configChanges="orientation|screenSize|keyboardHidden|screenLayout"
            android:windowSoftInputMode="adjustResize"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;
  fs.writeFileSync(path.join(BUILD_DIR, 'AndroidManifest.xml'), manifestContent);

  // 3. Write resources
  console.log('3. Writing strings & styles...');
  fs.writeFileSync(path.join(RES_DIR, 'values', 'strings.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Boxmusic</string>
</resources>`);

  // 4. Write MainActivity.java
  console.log('4. Writing MainActivity.java...');
  const mainActivityContent = `package com.boxmusic.player;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private WebView webView;
    private MediaSession mediaSession;
    private NotificationManager notificationManager;
    private static final String CHANNEL_ID = "boxmusic_live_channel";
    private static final int NOTIF_ID = 1088;
    private static final String ASSET_URL = "file:///android_asset/index.html";

    private String currentTitle = "Boxmusic";
    private String currentArtist = "San sang phat nhac";
    private boolean currentIsPlaying = false;
    private Bitmap currentCover = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
        }

        applyFullScreen();

        initMediaSession();

        // Android 13+ Notification Permission Request for HyperOS / Dynamic Island
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 101);
            }
        }

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (!failingUrl.startsWith("file:///android_asset/")) {
                    view.loadUrl(ASSET_URL);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !request.getUrl().toString().startsWith("file:///android_asset/")) {
                    view.loadUrl(ASSET_URL);
                }
            }
        });

        setContentView(webView);
        webView.loadUrl(ASSET_URL);
    }

    private void initMediaSession() {
        try {
            notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && notificationManager != null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Boxmusic Live Island",
                    NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("Dieu khien nhac tren HyperOS Dynamic Island");
                channel.setShowBadge(false);
                channel.setSound(null, null);
                notificationManager.createNotificationChannel(channel);
            }

            mediaSession = new MediaSession(this, "BoxmusicSession");
            mediaSession.setFlags(MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS | MediaSession.FLAG_HANDLES_MEDIA_BUTTONS);
            mediaSession.setCallback(new MediaSession.Callback() {
                @Override
                public void onPlay() {
                    runOnUiThread(() -> {
                        if (webView != null) webView.evaluateJavascript("if (window.musicPlayer) window.musicPlayer.play();", null);
                    });
                }

                @Override
                public void onPause() {
                    runOnUiThread(() -> {
                        if (webView != null) webView.evaluateJavascript("if (window.musicPlayer) window.musicPlayer.pause();", null);
                    });
                }

                @Override
                public void onSkipToNext() {
                    runOnUiThread(() -> {
                        if (webView != null) webView.evaluateJavascript("if (window.musicPlayer) window.musicPlayer.next();", null);
                    });
                }

                @Override
                public void onSkipToPrevious() {
                    runOnUiThread(() -> {
                        if (webView != null) webView.evaluateJavascript("if (window.musicPlayer) window.musicPlayer.prev();", null);
                    });
                }

                @Override
                public void onStop() {
                    runOnUiThread(() -> {
                        if (webView != null) webView.evaluateJavascript("if (window.musicPlayer) window.musicPlayer.pause();", null);
                    });
                }
            });

            Intent intent = new Intent(this, MainActivity.class);
            PendingIntent pi = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            mediaSession.setSessionActivity(pi);
            mediaSession.setActive(true);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public class AndroidBridge {
        @JavascriptInterface
        public void updateMedia(final String title, final String artist, final String coverUrl, final boolean isPlaying) {
            runOnUiThread(() -> {
                currentTitle = (title != null && !title.isEmpty()) ? title : "Boxmusic";
                currentArtist = (artist != null && !artist.isEmpty()) ? artist : "Dang phat";
                currentIsPlaying = isPlaying;

                updateNotificationAndSession(coverUrl);
            });
        }
    }

    private void updateNotificationAndSession(final String coverUrl) {
        if (mediaSession == null) return;

        if (coverUrl != null && (coverUrl.startsWith("http://") || coverUrl.startsWith("https://"))) {
            new Thread(() -> {
                try {
                    URL url = new URL(coverUrl);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setDoInput(true);
                    conn.setConnectTimeout(3000);
                    conn.connect();
                    InputStream input = conn.getInputStream();
                    Bitmap bmp = BitmapFactory.decodeStream(input);
                    if (bmp != null) {
                        currentCover = bmp;
                    }
                } catch (Exception ignored) {}
                runOnUiThread(() -> postMediaNotification());
            }).start();
        } else {
            postMediaNotification();
        }
    }

    private void postMediaNotification() {
        if (mediaSession == null || notificationManager == null) return;

        try {
            long actions = PlaybackState.ACTION_PLAY
                         | PlaybackState.ACTION_PAUSE
                         | PlaybackState.ACTION_SKIP_TO_NEXT
                         | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                         | PlaybackState.ACTION_STOP;

            PlaybackState.Builder stateBuilder = new PlaybackState.Builder()
                .setActions(actions)
                .setState(currentIsPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1.0f);
            mediaSession.setPlaybackState(stateBuilder.build());

            MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, "Boxmusic");

            if (currentCover != null) {
                metaBuilder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, currentCover);
            }
            mediaSession.setMetadata(metaBuilder.build());

            Intent openIntent = new Intent(this, MainActivity.class);
            PendingIntent pOpen = PendingIntent.getActivity(this, 10, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Intent prevIntent = new Intent(this, MainActivity.class).setAction("com.boxmusic.ACTION_PREV");
            PendingIntent pPrev = PendingIntent.getActivity(this, 11, prevIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Intent playIntent = new Intent(this, MainActivity.class).setAction("com.boxmusic.ACTION_TOGGLE_PLAY");
            PendingIntent pPlay = PendingIntent.getActivity(this, 12, playIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Intent nextIntent = new Intent(this, MainActivity.class).setAction("com.boxmusic.ACTION_NEXT");
            PendingIntent pNext = PendingIntent.getActivity(this, 13, nextIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Notification.Builder nb;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nb = new Notification.Builder(this, CHANNEL_ID);
            } else {
                nb = new Notification.Builder(this);
            }

            nb.setSmallIcon(R.drawable.ic_launcher)
              .setContentTitle(currentTitle)
              .setContentText(currentArtist)
              .setContentIntent(pOpen)
              .setOngoing(currentIsPlaying)
              .setVisibility(Notification.VISIBILITY_PUBLIC);

            if (currentCover != null) {
                nb.setLargeIcon(currentCover);
            }

            nb.addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Prev", pPrev).build());
            nb.addAction(new Notification.Action.Builder(currentIsPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, currentIsPlaying ? "Pause" : "Play", pPlay).build());
            nb.addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Next", pNext).build());

            Notification.MediaStyle mediaStyle = new Notification.MediaStyle();
            mediaStyle.setMediaSession(mediaSession.getSessionToken());
            mediaStyle.setShowActionsInCompactView(0, 1, 2);
            nb.setStyle(mediaStyle);

            notificationManager.notify(NOTIF_ID, nb.build());
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && intent.getAction() != null) {
            String action = intent.getAction();
            if ("com.boxmusic.ACTION_TOGGLE_PLAY".equals(action)) {
                runOnUiThread(() -> {
                    if (webView != null) webView.evaluateJavascript("if (window.musicPlayer) window.musicPlayer.togglePlay();", null);
                });
            } else if ("com.boxmusic.ACTION_NEXT".equals(action)) {
                runOnUiThread(() -> {
                    if (webView != null) webView.evaluateJavascript("if (window.musicPlayer) window.musicPlayer.next();", null);
                });
            } else if ("com.boxmusic.ACTION_PREV".equals(action)) {
                runOnUiThread(() -> {
                    if (webView != null) webView.evaluateJavascript("if (window.musicPlayer) window.musicPlayer.prev();", null);
                });
            }
        }
    }

    private void applyFullScreen() {
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                  | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                  | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                  | View.SYSTEM_UI_FLAG_FULLSCREEN
                  | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                  | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
        getWindow().getDecorView().setSystemUiVisibility(flags);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyFullScreen();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (mediaSession != null) {
            mediaSession.release();
        }
        if (notificationManager != null) {
            notificationManager.cancel(NOTIF_ID);
        }
    }
}
`;
  fs.writeFileSync(path.join(SRC_DIR, 'MainActivity.java'), mainActivityContent);

  const workDir = path.join(BUILD_DIR, 'work');
  const compiledRes = path.join(workDir, 'compiled_res.zip');
  const baseApk = path.join(workDir, 'base.apk');
  const unalignedApk = path.join(workDir, 'unaligned.apk');
  const alignedApk = path.join(workDir, 'aligned.apk');
  const classesDir = path.join(workDir, 'classes');
  const dexDir = path.join(workDir, 'dex');
  fs.mkdirSync(classesDir, { recursive: true });
  fs.mkdirSync(dexDir, { recursive: true });

  // 5. Compile resources with AAPT2
  console.log('5. Compiling resources with AAPT2...');
  execSync(`"${AAPT2}" compile --dir "${RES_DIR}" -o "${compiledRes}"`, { stdio: 'inherit' });

  // 6. Link resources with AAPT2 (SDK 26 -> 34)
  console.log('6. Linking APK shell with AAPT2 (SDK 26 -> 34)...');
  execSync(`"${AAPT2}" link -I "${ANDROID_JAR}" --min-sdk-version 26 --target-sdk-version 34 --manifest "${path.join(BUILD_DIR, 'AndroidManifest.xml')}" -o "${baseApk}" "${compiledRes}" --java "${path.join(BUILD_DIR, 'src')}"`, { stdio: 'inherit' });

  // 7. Compile Java with javac (Java 8 bytecode compatibility)
  console.log('7. Compiling Java sources with javac (target 8)...');
  const javaFiles = getFilesRecursively(path.join(BUILD_DIR, 'src'), '.java');
  const javaArgs = javaFiles.map(f => `"${f}"`).join(' ');
  execSync(`"${JAVAC}" -encoding UTF-8 -source 8 -target 8 -cp "${ANDROID_JAR}" -d "${classesDir}" ${javaArgs}`, { stdio: 'inherit' });

  // 8. Convert to DEX with D8
  console.log('8. Converting classes to DEX with D8...');
  const classFiles = getFilesRecursively(classesDir, '.class');
  const classArgs = classFiles.map(f => `"${f}"`).join(' ');
  execSync(`"${JAVA}" -cp "${D8_JAR}" com.android.tools.r8.D8 --lib "${ANDROID_JAR}" --output "${dexDir}" ${classArgs}`, { stdio: 'inherit' });

  // Compile ApkPacker utility
  execSync(`"${JAVAC}" -encoding UTF-8 -d "${BUILD_DIR}" "${path.join(BUILD_DIR, 'ApkPacker.java')}"`, { stdio: 'inherit' });

  // 9. Pack base.apk + assets + classes.dex with ApkPacker (guarantees STORED uncompressed resources.arsc + POSIX forward slashes)
  console.log('9. Packaging APK with ApkPacker (uncompressed resources.arsc + POSIX paths)...');
  const dexFile = path.join(dexDir, 'classes.dex');
  execSync(`"${JAVA}" -cp "${BUILD_DIR}" ApkPacker "${baseApk}" "${ASSETS_DIR}" "${dexFile}" "${unalignedApk}"`, { stdio: 'inherit' });

  // 10. Align APK with zipalign (4-byte alignment on uncompressed resources.arsc)
  console.log('10. Aligning APK with zipalign (4-byte boundary)...');
  execSync(`"${ZIPALIGN}" -p -f 4 "${unalignedApk}" "${alignedApk}"`, { stdio: 'inherit' });

  // 11. Generate keystore if needed
  const keystorePath = path.join(BUILD_DIR, 'boxmusic-release.keystore');
  if (!fs.existsSync(keystorePath)) {
    console.log('11. Generating release keystore...');
    execSync(`"${KEYTOOL}" -genkey -v -keystore "${keystorePath}" -storepass boxmusic123 -alias boxmusickey -keypass boxmusic123 -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Boxmusic,OU=Audio,O=Retro,L=Hanoi,ST=HN,C=VN"`, { stdio: 'ignore' });
  }

  // 12. Sign APK with apksigner (V1 + V2 + V3 signature)
  console.log('12. Signing APK with apksigner (V1 + V2 + V3 signature)...');
  execSync(`"${JAVA}" -jar "${APKSIGNER_JAR}" sign --ks "${keystorePath}" --ks-pass pass:boxmusic123 --ks-key-alias boxmusickey --key-pass pass:boxmusic123 --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --out "${FINAL_APK}" "${alignedApk}"`, { stdio: 'inherit' });

  // 13. Verify signature
  console.log('13. Verifying APK signature...');
  execSync(`"${JAVA}" -jar "${APKSIGNER_JAR}" verify -v "${FINAL_APK}"`, { stdio: 'inherit' });

  // Also make Boxmusic-Pro.apk and Boxmusic-v2.apk to avoid any browser cache or filename collision
  const proApk = path.join(OUTPUT_DIR, 'Boxmusic-Pro.apk');
  const v2Apk = path.join(OUTPUT_DIR, 'Boxmusic-v2.apk');
  fs.copyFileSync(FINAL_APK, proApk);
  fs.copyFileSync(FINAL_APK, v2Apk);

  const stats = fs.statSync(FINAL_APK);
  console.log('\n======================================================');
  console.log('🎉 SUCCESS! ANDROID APK COMPILED & SIGNED SUCCESSFULLY!');
  console.log(`- APK Standard: ${FINAL_APK}`);
  console.log(`- APK Pro:      ${proApk}`);
  console.log(`- APK v2:       ${v2Apk}`);
  console.log(`- Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log('======================================================\n');
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
