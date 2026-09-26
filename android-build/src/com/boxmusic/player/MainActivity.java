package com.boxmusic.player;

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
