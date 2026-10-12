/* 联网取数：连 WiFi，向课表代理要那一小包「今天 / 接下来」
 *
 * 只干这一件事。取回来的原文直接塞进调用方给的缓冲区（那是个带 RTC 属性的
 * 数组，睡一觉之后还在），省得再定义一套结构体。
 */

#ifndef OP_NET_H
#define OP_NET_H

#include <Arduino.h>

namespace Net {

struct Result {
  int code;            /* 0 = 成功；其余见下面 Net::fetch 里的注释 */
  char message[48];    /* 出错时给人看的一句话（英文，屏幕字库只有 ASCII） */
};

bool connectWifi(uint32_t timeoutMs);
void stopWifi();

/* 成功时把响应体写进 buffer（补 '\0'），并返回 code = 0
 *   1 = WiFi 没连上
 *   2 = HTTPS 连接/请求失败
 *   3 = 服务器返回非 200
 *   4 = 响应太大，缓冲区放不下
 *   5 = 响应里 ok 不是 true（学号密码错、上游超时等，message 里有原因）
 */
Result fetch(const char *url, const char *sid, const char *pwd,
             char *buffer, size_t capacity);

}  /* namespace Net */

#endif /* OP_NET_H */
