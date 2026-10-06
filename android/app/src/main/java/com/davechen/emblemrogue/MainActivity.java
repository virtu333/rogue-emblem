package com.davechen.emblemrogue;

import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Matches PHONE_MAX_SHORT_SIDE in src/utils/portraitBattle.js: a screen whose
    // shorter side is at least this many dp (CSS px in the WebView) is a tablet,
    // which the game treats as a landscape-locked shell (isLandscapeLockedShell).
    private static final int TABLET_MIN_SHORT_SIDE_DP = 600;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Phones turn freely (portrait mode is on by default); tablets stay landscape,
        // like the iPad app.
        if (getResources().getConfiguration().smallestScreenWidthDp >= TABLET_MIN_SHORT_SIDE_DP) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        }
        super.onCreate(savedInstanceState);
        hideSystemBars();
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    // Full screen, as the iOS app hides its status bar: a swipe from the edge shows
    // the bars for a moment and they hide again on their own.
    private void hideSystemBars() {
        Window window = getWindow();
        View decor = window.getDecorView();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
