#include "net.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#if !__has_include("config.h")
#error "缺少 include/config.h：把 include/config.example.h 复制一份改名成 config.h，填上 WiFi 和账号。"
#endif
#include "config.h"

bool Net::connectWifi(uint32_t timeoutMs) {
  WiFi.persistent(false);        /* 不要把配网信息写进 Flash，费寿命 */
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(true);           /* 等回包的时候允许休眠，能省不少电 */
  WiFi.begin(OP_WIFI_SSID, OP_WIFI_PASS);

  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - started) < timeoutMs) {
    delay(100);
  }
#if OP_SERIAL_LOG
  Serial.printf("[net] WiFi %s，用时 %lu ms\n",
                WiFi.status() == WL_CONNECTED ? "已连接" : "连不上",
                (unsigned long)(millis() - started));
#endif
  return WiFi.status() == WL_CONNECTED;
}

void Net::stopWifi() {
  WiFi.disconnect(true, false);
  WiFi.mode(WIFI_OFF);
}

Net::Result Net::fetch(const char *url, const char *sid, const char *pwd,
                       char *buffer, size_t capacity) {
  Result result;
  result.code = 0;
  result.message[0] = '\0';

  if (WiFi.status() != WL_CONNECTED) {
    result.code = 1;
    snprintf(result.message, sizeof(result.message), "no wifi");
    return result;
  }

  /* 请求体用 JSON 拼，密码里有引号也不会拼坏 */
  JsonDocument request;
  request["sid"] = sid;
  request["pwd"] = pwd;
  String body;
  serializeJson(request, body);

  WiFiClientSecure client;
  /* 这里不校验服务器证书（板子上没有时钟的初始状态、也就没有可信时间做校验）。
     介意的话把 Cloudflare 的根证书贴进来，换成 client.setCACert(...) */
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(OP_HTTP_TIMEOUT_MS);
  http.setReuse(false);
  if (!http.begin(client, url)) {
    result.code = 2;
    snprintf(result.message, sizeof(result.message), "https begin failed");
    return result;
  }
  http.addHeader("Content-Type", "application/json");

  const int status = http.POST((uint8_t *)body.c_str(), body.length());
  if (status != 200) {
    result.code = 3;
    snprintf(result.message, sizeof(result.message), "http %d", status);
    http.end();
    return result;
  }

  const String payload = http.getString();
  http.end();

  if (payload.length() == 0 || payload.length() >= capacity) {
    result.code = 4;
    snprintf(result.message, sizeof(result.message), "payload %u bytes",
             (unsigned)payload.length());
    return result;
  }

  /* 先看一眼是不是 ok，不是的话把原因带给屏幕 */
  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, payload);
  if (err) {
    result.code = 5;
    snprintf(result.message, sizeof(result.message), "bad json");
    return result;
  }
  if (doc["ok"] != true) {
    result.code = 5;
    const char *why = doc["error"] | "server refused";
    snprintf(result.message, sizeof(result.message), "%s", why);
    return result;
  }

  memcpy(buffer, payload.c_str(), payload.length() + 1);
  return result;
}
