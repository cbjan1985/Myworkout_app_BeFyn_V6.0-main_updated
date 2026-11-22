package APP_PACKAGE;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(GifFolderPlugin.class);
    registerPlugin(BeFynHealthPlugin.class); // HEALTH_PLUGIN (removed automatically by the fallback build)
    super.onCreate(savedInstanceState);
    // keep the screen on so workout timers and voice guidance keep running
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }
}
