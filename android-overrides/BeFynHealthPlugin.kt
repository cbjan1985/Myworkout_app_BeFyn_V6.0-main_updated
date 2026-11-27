package APP_PACKAGE

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeightRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.time.Duration
import java.time.Instant
import kotlin.reflect.KClass
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Read-only bridge to Android Health Connect. BeFyn never writes health data.
 * JS contract (see www/src/platform/health.js): getStatus, requestHealthAccess, readRecords, openSettings.
 * NOTE: the method is deliberately NOT called requestPermissions: Capacitor's Plugin base class already has one, and a same-named
 * Kotlin function fails to compile ("hides member of supertype 'Plugin' and needs 'override' modifier").
 */
@CapacitorPlugin(name = "BeFynHealth")
class BeFynHealthPlugin : Plugin() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  private val types: Map<String, KClass<out Record>> = mapOf(
    "steps" to StepsRecord::class,
    "activeCalories" to ActiveCaloriesBurnedRecord::class,
    "heartRate" to HeartRateRecord::class,
    "sleep" to SleepSessionRecord::class,
    "exercise" to ExerciseSessionRecord::class,
    "weight" to WeightRecord::class,
    "bodyFat" to BodyFatRecord::class,
    "height" to HeightRecord::class,
    "oxygenSaturation" to OxygenSaturationRecord::class,
  )

  private fun permissionFor(type: String): String = HealthPermission.getReadPermission(types.getValue(type))

  private fun availability(): String {
    if (Build.VERSION.SDK_INT < 26) return "not_supported"
    return when (HealthConnectClient.getSdkStatus(context)) {
      HealthConnectClient.SDK_AVAILABLE -> "available"
      HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update_required"
      HealthConnectClient.SDK_UNAVAILABLE -> "not_installed"
      else -> "not_supported"
    }
  }

  private suspend fun grantedTypes(): JSArray {
    val client = HealthConnectClient.getOrCreate(context)
    val granted = client.permissionController.getGrantedPermissions()
    val out = JSArray()
    types.keys.filter { permissionFor(it) in granted }.forEach { out.put(it) }
    return out
  }

  @PluginMethod
  fun getStatus(call: PluginCall) {
    val a = availability()
    if (a != "available") {
      call.resolve(JSObject().put("availability", a).put("granted", JSArray()))
      return
    }
    scope.launch {
      try {
        call.resolve(JSObject().put("availability", "available").put("granted", grantedTypes()))
      } catch (e: Exception) {
        call.reject(e.message ?: "Could not read Health Connect status")
      }
    }
  }

  @PluginMethod
  fun requestHealthAccess(call: PluginCall) {
    if (availability() != "available") { call.reject("Health Connect is not available on this device."); return }
    val wanted = try { call.getArray("types").toList<String>() } catch (e: Exception) { emptyList() }
    val perms = wanted.filter { types.containsKey(it) }.map { permissionFor(it) }.toSet()
    if (perms.isEmpty()) { call.reject("Choose at least one data type."); return }
    val intent = PermissionController.createRequestPermissionResultContract().createIntent(context, perms)
    startActivityForResult(call, intent, "permissionsResult")
  }

  @ActivityCallback
  fun permissionsResult(call: PluginCall?, result: ActivityResult?) {
    if (call == null) return
    scope.launch {
      try { call.resolve(JSObject().put("granted", grantedTypes())) }
      catch (e: Exception) { call.reject(e.message ?: "Could not read granted permissions") }
    }
  }

  @PluginMethod
  fun openSettings(call: PluginCall) {
    try {
      activity.startActivity(Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS))
      call.resolve()
    } catch (e: Exception) {
      try {
        activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.apps.healthdata")))
        call.resolve()
      } catch (e2: Exception) { call.reject("Could not open Health Connect.") }
    }
  }

  private fun source(meta: Metadata): String = when (val p = meta.dataOrigin.packageName) {
    "com.google.android.apps.fitness" -> "Google Fit"
    "com.google.android.apps.healthdata" -> "Health Connect"
    "com.sec.android.app.shealth" -> "Samsung Health"
    else -> p.substringAfterLast('.').replaceFirstChar { it.uppercase() }
  }

  private fun rec(meta: Metadata, start: Instant, end: Instant?, value: Double, extra: JSObject? = null): JSObject {
    val o = JSObject()
    o.put("id", meta.id); o.put("start", start.toString()); o.put("end", (end ?: start).toString())
    o.put("value", value); o.put("source", source(meta))
    if (extra != null) o.put("extra", extra)
    return o
  }

  private suspend fun <T : Record> readAll(
    client: HealthConnectClient, type: KClass<T>, start: Instant, end: Instant, out: JSArray, map: (T) -> JSObject?,
  ) {
    var token: String? = null
    do {
      val resp = client.readRecords(ReadRecordsRequest(type, TimeRangeFilter.between(start, end), pageSize = 1000, pageToken = token))
      resp.records.forEach { r -> map(r)?.let { out.put(it) } }
      token = resp.pageToken
    } while (!token.isNullOrEmpty())
  }

  @PluginMethod
  fun readRecords(call: PluginCall) {
    val type = call.getString("type")
    val s = call.getString("start"); val e = call.getString("end")
    if (type == null || s == null || e == null || !types.containsKey(type)) { call.reject("type, start and end are required."); return }
    if (availability() != "available") { call.reject("Health Connect is not available on this device."); return }
    scope.launch {
      try {
        val client = HealthConnectClient.getOrCreate(context)
        val start = Instant.parse(s); val end = Instant.parse(e); val out = JSArray()
        when (type) {
          "steps" -> readAll(client, StepsRecord::class, start, end, out) { r -> rec(r.metadata, r.startTime, r.endTime, r.count.toDouble()) }
          "activeCalories" -> readAll(client, ActiveCaloriesBurnedRecord::class, start, end, out) { r -> rec(r.metadata, r.startTime, r.endTime, r.energy.inKilocalories) }
          "heartRate" -> readAll(client, HeartRateRecord::class, start, end, out) { r ->
            val bpm = r.samples.map { it.beatsPerMinute.toDouble() }
            if (bpm.isEmpty()) null else rec(r.metadata, r.startTime, r.endTime, bpm.average(), JSObject().put("min", bpm.min()).put("max", bpm.max()))
          }
          "sleep" -> readAll(client, SleepSessionRecord::class, start, end, out) { r -> rec(r.metadata, r.startTime, r.endTime, Duration.between(r.startTime, r.endTime).toMinutes() / 60.0) }
          "exercise" -> readAll(client, ExerciseSessionRecord::class, start, end, out) { r -> rec(r.metadata, r.startTime, r.endTime, Duration.between(r.startTime, r.endTime).toMinutes().toDouble(), JSObject().put("title", r.title ?: "")) }
          "weight" -> readAll(client, WeightRecord::class, start, end, out) { r -> rec(r.metadata, r.time, null, r.weight.inKilograms) }
          "bodyFat" -> readAll(client, BodyFatRecord::class, start, end, out) { r -> rec(r.metadata, r.time, null, r.percentage.value) }
          "height" -> readAll(client, HeightRecord::class, start, end, out) { r -> rec(r.metadata, r.time, null, r.height.inMeters * 100.0) }
          "oxygenSaturation" -> readAll(client, OxygenSaturationRecord::class, start, end, out) { r -> rec(r.metadata, r.time, null, r.percentage.value) }
        }
        call.resolve(JSObject().put("records", out))
      } catch (ex: SecurityException) {
        call.reject("Permission for this data type was not granted.")
      } catch (ex: Exception) {
        call.reject(ex.message ?: "Could not read health data.")
      }
    }
  }
}
