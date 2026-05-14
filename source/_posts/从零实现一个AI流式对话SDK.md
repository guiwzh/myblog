---
title: 从零实现一个 AI 流式对话 SDK：一个前端的认知升级之旅
date: 2026-05-15 16:00:00
tags:
  - 前端
  - AI
  - SSE
  - 异步编程
  - SDK
categories:
  - 前端
description: 从「流是什么」讲起，逐层拆解 ReadableStream、TextDecoder、SSE 协议、AbortController 语义二义性，最后组装成一个能在 CLI 里多轮对话的 AI SDK，沿途分享那些只有踩过坑才会真正理解的反直觉认知。
cover: https://picsum.photos/seed/ai-stream-sdk/800/450
---

> 这篇文章记录了我从「完全没接触过流式 API」到「能在 CLI 里和 AI 实时对话」的完整过程。比起代码本身，我更想分享的是中间那些**反直觉的认知拐点**——那些只有亲手踩过坑才会真正理解的东西。

## 缘起

我想给简历加一个有分量的项目。听说「封装一个 SDK」是个不错的方向，能体现工程化思维和抽象能力。在一堆候选里——监控 SDK、请求库、上传 SDK、虚拟列表——我最后选了 **AI 流式对话 SDK**。

理由很简单：

1. 2026 年了，这是**时代红利**。几乎所有产品都在塞 AI 对话能力，会做这个的前端是稀缺的。
2. 它的技术栈横跨**网络协议、异步编程、状态机、UI 渲染**，深度足够撑起面试故事。
3. 之前我连「流」是什么都说不清楚，正好借这个机会补一块基础。

下面是我一路上踩过的所有坑，按真实顺序。

---

## 一、起点：「流」到底是什么

我以前写接口是这样的：

```js
const res = await fetch('/api/user');
const data = await res.json();
console.log(data);
```

`await res.json()` 之前我从来没想过——服务器到底是「一次性把整个 JSON 砰一下扔过来」，还是「一个字节一个字节传过来，浏览器攒齐了再给我」？

答案是后者，但更精确地说：**数据是以「块」（chunk）为单位到达的**。一个 chunk 可能是 100 字节、可能是 2KB，大小不固定，由网络栈决定。

`res.json()` 在背后做了三件事：把所有 chunk 拼起来、确认流结束、解析成 JSON。它**藏起了「等待」**，让你以为响应是「瞬间到达」的。

流式 API 的本质就是——**不再隐藏这个过程**。让你能在第一个 chunk 到达时就开始处理，而不是等全部。

打个比方：

> 传统 HTTP 像是「服务员等整桌菜做完一起端」，你干等 20 分钟。  
> 流式 HTTP 像是「前菜做好先端，主菜好了再端」，你从第 2 分钟开始就有得吃。  
> 两种方式用的是同一个服务员、同一条传菜通道——区别只在「端菜策略」。

## 二、`res.body` 不是字符串

这是我第一个反直觉的认知。要讲清楚，得先弄明白 `await fetch(...)` 拿到的那个 `res` **到底是什么**。

### `res` 是一个 `Response` 对象

`fetch` 返回的不是数据本身，而是一个 `Response` **对象**——它代表了「这次请求的整个响应」，包含元信息（状态码、headers）和**指向响应体的指针**。

```js
const res = await fetch('/api/stream');

console.log(res.status);      // 200
console.log(res.ok);          // true
console.log(res.headers);     // Headers 对象
console.log(res.body);        // ReadableStream { locked: false }   ← 注意
```

注意最后那行——`res.body` **不是字符串、不是对象、不是数组**，是一个 `ReadableStream`。

平时我们写 `await res.json()` 或 `await res.text()`，那些方法都是 `Response` 对象上的**便捷封装**——它们在背后做了三件事：

1. 调用 `res.body` 的底层接口，把所有 chunk 读完
2. 拼成完整字节序列
3. 按指定格式解码（`text()` 解成字符串、`json()` 进一步 `JSON.parse`）

也就是说——**`res.text()` / `res.json()` 内部本来就是流式读取的**，只是它们把过程藏起来了，等全部读完才一次性返回结果。我们要做的，就是**绕开这层封装，自己控制读取节奏**，从第一个 chunk 到达时就开始消费。

### `ReadableStream`：可读流的标准抽象

`res.body` 这个 `ReadableStream` 是 W3C 标准的「可读流」类型。它**不存数据**，它只是个**接口**——告诉你「数据将通过我这个通道流过来，想取数据按下面这套 API 来」。

我喜欢这个比喻：

> `res.body` 不是一桶水，是水龙头。  
> 你不能直接打印水的内容，得**打开龙头、接水、装杯**。

水龙头本身不存水——它只是个出水口。你打开它，水从管道（TCP 连接）流过来；你关上它（`cancel()`），水就不再流。

`ReadableStream` 有两种消费方式：

1. **手动模式**：`getReader()` 拿到一个读取器，自己控制每次读多少
2. **自动模式**：用 `pipeTo()` / `pipeThrough()` 接到另一个流上，比如 `WritableStream`

做 AI SDK 我们**永远用手动模式**——因为我们要在每个 chunk 到达时做自定义解析（SSE 格式、JSON 拆分），不能让浏览器自动处理。

### `getReader()`：把流「锁定」给你

```js
const reader = res.body.getReader();
```

`getReader()` 做了两件关键的事：

1. **返回一个 `ReadableStreamDefaultReader` 对象**——这是你接下来取数据的「凭证」
2. **「锁定」这个流**——一个流同时只能有一个 reader。锁定后 `res.body.locked` 变成 `true`，**别人再调 `getReader()` 会直接抛错**

为什么要锁？因为流是一次性的——数据「流过」就没了。如果允许多个 reader 同时读，每个都只能读到一部分，谁也拼不出完整数据。**锁定机制保证了「同一份流只有一个消费者」**，避免数据撕裂。

设计上这是借鉴了**所有权语义**（类似 Rust 的 ownership）——一份独占的数据流，所有权要么在 stream 上，要么在 reader 上，永远不会同时。这种「独占」的设计在并发场景下能避免一大堆 bug，是个值得学习的范式。

> **顺带一提**：如果你想让多方都消费同一个流，得用 `res.body.tee()`——它返回两个独立的 `ReadableStream`，分别可以各自 `getReader()`。常用于「一边渲染、一边把原始数据存到 IndexedDB」这种场景。

### `reader.read()`：拿一块数据

拿到 reader 之后，真正取数据的方法是 `read()`：

```js
const { value, done } = await reader.read();
```

它返回一个 Promise，resolve 后得到 `{ value, done }`：

- **`done: boolean`**——告诉你流结束了没。`true` 表示「不会再有数据了」，这时 `value` 是 `undefined`
- **`value: Uint8Array`**——本次到达的字节块（一个 chunk）。**不是字符串**

两个反常识的点：

**① `value` 是 `Uint8Array`，不是字符串**

为什么不是字符串？因为网络传输层（TCP/IP）**根本不认识字符**——它只传字节（byte）。同样一段字节序列，可能是 UTF-8 文本、可能是图片、可能是音频、可能是加密数据。**字节是否能解释成字符、按什么编码解释，是上层应用的事**。

`Uint8Array` 是 JS 里表示「定长字节数组」的标准类型，每个元素是 0~255 的整数。比如 UTF-8 的「中」字 3 个字节，长这样：

```js
new Uint8Array([0xE4, 0xB8, 0xAD])   // 「中」
```

**这种设计让 fetch + Stream 能处理任何类型的响应**——不光是文本，还能流式下载视频、解码 protobuf、处理二进制协议。代价就是：**你得自己解码**。

**② `reader.read()` 返回 Promise**

下一个 chunk 可能还没到（要等网络），所以 `read()` 必须是异步的——它返回 Promise，你 `await` 等数据到达。

这件事的深层影响下一节会展开——它直接关系到「为什么 `while (true)` 不卡浏览器」。

### `TextDecoder`：把字节翻译成字符

既然 `value` 是字节而不是字符串，我们需要一个工具把字节按 UTF-8（或其他编码）翻译过来——这就是 `TextDecoder`：

```js
const decoder = new TextDecoder();        // 默认 utf-8
const text = decoder.decode(value);       // Uint8Array → string
```

`TextDecoder` 是 W3C 的 Encoding Standard 定义的浏览器原生 API，支持几十种编码（utf-8、gbk、shift_jis……）。**做中文 / 国际化项目时是绕不开的工具**，但绝大多数前端都没用过它——因为 `res.text()` 在内部替你调了。

构造时可以指定编码：

```js
new TextDecoder('utf-8');          // 默认值
new TextDecoder('gbk');            // 老旧中文系统可能用
new TextDecoder('iso-8859-1');     // 西欧
```

**有一个关键参数我们后面会重点讲**：

```js
decoder.decode(value, { stream: true });
```

加上 `{ stream: true }` 会让 decoder **跨多次调用维持内部状态**——因为多字节字符（比如中文 3 字节）可能被切在两个 chunk 中间。这块第五节细讲。

### 把这些拼起来：最小消费循环

知识铺垫够了，现在看这段代码每一行你都应该清楚了：

```js
const res = await fetch('/api/stream');     // res 是 Response 对象
const reader = res.body.getReader();        // 锁定流，拿到读取器
const decoder = new TextDecoder();          // 准备字节 → 字符串的翻译器

while (true) {
  const { value, done } = await reader.read();  // 等下一个 chunk
  if (done) break;                              // 流结束了
  const text = decoder.decode(value);           // 字节翻译成字符串
  console.log('收到一块:', text);
}
```

四个 API 各司其职：

| API | 职责 | 类比 |
|-----|------|------|
| `Response` 对象 | 包装响应元数据 + 体指针 | 快递面单 + 包裹 |
| `ReadableStream` | 数据通道的抽象 | 水龙头 |
| `Reader` | 独占读取凭证 | 水杯 |
| `TextDecoder` | 字节解码器 | 翻译官 |

理解了这套分工，后面我们手撕 SSE 解析器才不会迷茫——**它本质上就是在这四个 API 之上再加一层「按业务消息切分」的逻辑**。

## 三、`while (true)` 为什么不卡浏览器？

这是我学习过程里**最重要的一个认知**。

如果把 `await reader.read()` 换成同步的耗时代码，循环会把浏览器卡死。但加上 `await`，浏览器就一直顺滑。为什么？

关键在 `await` 这两个字。它做了这件事：

1. 调用 `reader.read()` 立刻返回一个 Promise
2. `await` 看到 Promise 没 resolve，**把当前函数暂停并交还控制权给浏览器**
3. 浏览器拿回控制权——渲染页面、响应点击、跑其他代码
4. 网络层收到下一个 chunk，Promise resolve
5. 函数从暂停处恢复，拿到 `value`

所以 `while (true)` **大部分时间根本没在跑**——它在 `await` 那一行「睡着」。

> 同步 `while (true)`：你在收银台不停问「到我了吗？」——堵死所有人。  
> `await` 的 `while (true)`：你拿了排队号坐去玩手机，叫号了再过来。

**`await` 的本质是「主动让出」**。它把「忙等」变成「事件驱动」。

### 一个判断题

下面这段代码会怎样？

```js
while (true) {
  const { value, done } = reader.read();  // ← 没有 await
  if (done) break;
}
```

我当时凭直觉觉得是「一次性把流读完」。**错。正确答案是浏览器卡死**。

因为 `reader.read()` **本性就是异步的**——它返回 Promise 对象。没有 `await`，你拿到的是「承诺将来给你数据的盒子」，不是数据本身。`done` 是 `undefined`，永远不 break。循环狂转、堆积 Promise、不让出控制权——卡死。

**异步是事情本身的属性，不是你的选择**。判断一个函数是不是异步，看它干的活：
- 纯计算 → 同步
- 等外部资源（网络、文件、定时器）→ 异步

## 四、第一次亲眼见「流」

我跑了这段代码（公开测试接口，吐 20 行 JSON）：

```js
(async () => {
  const res = await fetch('https://httpbin.org/stream/20');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let chunkIndex = 0;
  
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunkIndex++;
    console.log(`📦 chunk #${chunkIndex} (${value.length} 字节):`, decoder.decode(value));
  }
})();
```

我以为会看到 20 个 chunk，每个 chunk 一条 JSON。

**实际看到的是 3 个 chunk，每个里塞了 6~7 条 JSON，最后一条 JSON 被切在了 chunk #2 和 chunk #3 中间**。

这一刻我才真正理解流式编程的核心痛点：

> **服务器按「消息」发，但你按「网络包」收。**  
> **chunk 边界和消息边界毫无关系。**

服务器明明是一行一行 `write` 的，到我这里被 TCP 层合并成了 3 个 chunk（Nagle 算法和 TCP 缓冲会把小数据攒一攒再发）。反过来大消息会被拆开。**你永远不知道下一个 chunk 什么时候来、有多大、在什么位置切开**。

## 五、Buffer 模式：流式编程的通用解法

既然 chunk 边界不可控，那就**维护一个 buffer**，做这件事：

1. 每次 chunk 到来，**追加**到 buffer 末尾
2. 按消息分隔符（这里是 `\n`）切分 buffer
3. **最后一段不动**（可能不完整），扔回 buffer 等下次拼接
4. 前面所有段都是完整消息，逐个处理

代码：

```js
let buffer = '';

while (true) {
  const { value, done } = await reader.read();
  if (done) {
    if (buffer.trim()) console.log('尾部残留:', JSON.parse(buffer));
    break;
  }
  
  buffer += decoder.decode(value, { stream: true });
  
  const lines = buffer.split('\n');
  buffer = lines.pop();  // ← 关键：最后一段可能不完整，留下
  
  for (const line of lines) {
    if (!line.trim()) continue;
    console.log('完整消息:', JSON.parse(line));
  }
}
```

### 两个魔鬼细节

**① `lines.pop()` 不是错误，是必须的**

`'a\nb\nc'.split('\n')` 得到 `['a', 'b', 'c']`。最后那个 `'c'` 后面没有 `\n`——它**可能完整、也可能不完整**，我们无法当场判断。保守做法：**永远扔回 buffer**。

如果是 `'a\nb\nc\n'`，split 得到 `['a', 'b', 'c', '']`，pop 出空串无害。

**这个「永远 pop 最后一段」的模式，是所有流式解析器的通用范式。** SSE、NDJSON、Protobuf 流——全这么写。

**② `decoder.decode(value, { stream: true })` 的 `stream: true`**

这解决了另一个层次的「切开」：**多字节字符被切在 chunk 边界**。

UTF-8 里「中」是 3 字节 `E4 B8 AD`。如果一个 chunk 末尾是 `E4 B8`、下一个开头是 `AD`，没加 `stream: true` 的话，decoder 会把不完整字节当无效字节渲染成 `�`，出现乱码。

加了 `stream: true`，decoder 内部也维护一个字节缓冲区——遇到不完整的多字节序列会暂存。**和我们外层 buffer 是同一个思想，只是工作在字节层**。

**任何接口可能含中文/emoji，永远加 `stream: true`**。

## 六、抽象成 async generator

业务代码不该和「读 chunk + 拼 buffer + 切分」混在一起。封装一下：

```js
async function* readLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      if (buffer) yield buffer;
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line) yield line;
    }
  }
}

// 调用方代码瞬间清爽：
const res = await fetch('https://httpbin.org/stream/20');
for await (const line of readLines(res)) {
  console.log(JSON.parse(line));
}
```

`async function*` + `yield` + `for await` 是流式 SDK 设计的核心利器。比 callback 优雅得多——天然支持 `await`、天然可取消、天然可组合。

## 七、SSE 协议：流式 AI 接口的标准

主流 AI 接口（OpenAI、Anthropic、智谱、通义、Kimi……）的流式响应都是 **SSE（Server-Sent Events）**。

为什么不是 WebSocket？

> 对话是**单向流**（服务器推给客户端），SSE 协议更简单、走标准 HTTPS、天然支持 HTTP/2、自带断线重连语义。WebSocket 是双向全双工，这里完全用不上，反而增加协议复杂度和代理穿透问题。

但浏览器原生的 `EventSource` 几乎没人用，因为它**只支持 GET、不能自定义 header**（没法塞 `Authorization`）。生产实践都是用 `fetch` + 手撕 SSE 解析器。

### SSE 长什么样

OpenAI 协议（也是事实标准）：

```
data: {"choices":[{"delta":{"content":"你"}}]}

data: {"choices":[{"delta":{"content":"好"}}]}

data: [DONE]

```

注意：

- 每行以 `data: ` 开头（冒号后**可选**空格）
- 消息之间用**双换行 `\n\n`** 隔开
- 结束有特殊标记 `data: [DONE]`

Anthropic 协议多了 `event:` 字段：

```
event: content_block_delta
data: {"type":"content_block_delta","delta":{"text":"你"}}

```

### 改造 generator

把分隔符从 `\n` 换成 `\n\n`，再加一层「事件块 → 对象」的解析：

```js
async function* parseSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      buffer += decoder.decode();              // flush 解码器残留字节
      if (buffer.trim()) yield parseEventBlock(buffer);
      return;
    }
    
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop();
    
    for (const block of blocks) {
      if (!block.trim()) continue;
      yield parseEventBlock(block);
    }
  }
}

function parseEventBlock(block) {
  const event = {};
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    
    const colonIdx = line.indexOf(':');   // ← 注意：indexOf，不是 split
    if (colonIdx === -1) continue;
    
    const field = line.slice(0, colonIdx);
    let value = line.slice(colonIdx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    event[field] = value;
  }
  return event;
}
```

### 又一个魔鬼细节

**`indexOf(':')` 而不是 `split(':')`**——因为 `data:` 后面的 JSON 里全是冒号。`split(':')` 会把 JSON 切碎，`indexOf` 只取第一个冒号的位置才对。

## 八、双层结束信号：传输层 vs 业务层

SSE 流的「结束」其实有**两个层次的信号**：

- **`done === true`**：HTTP 连接关了。**传输层**的事实。
- **`data: [DONE]`**：本次对话生成完了。**业务层**的约定。

为什么要两套？

> 想象你去快递点取包裹。  
>   
> 场景 A：快递员说「今天的包裹送完了」然后**收摊回家**。  
> 场景 B：快递员说「你的包裹送完了」，但快递点**还开着**给别人送。  
>   
> 这是两个层次的事件——「快递点关门」vs「你这单结束」。

具体到 SDK，两个信号**合起来**才能区分多种结束状态：

- 收到 `[DONE]` 然后 `done`：✅ 正常完成
- 只收到 `done` 没收到 `[DONE]`：⚠️ 异常中断，应触发重试

**这个「传输层 vs 业务层」的双重信号思想贯穿所有流式协议**：

- WebSocket：`close` 事件 vs 业务消息里的 `{type: "end"}`
- gRPC：流关闭 vs 业务 trailer

SDK 的职责是**把两层都抓住，对上层只暴露语义事件**——上层不该关心 HTTP 还是 WebSocket。

## 九、取消机制：AbortController 的语义二义性

用户在 AI 打字到一半时点「停止」，怎么实现？

```js
const controller = new AbortController();
fetch(url, { signal: controller.signal });

// 中止：
controller.abort();
```

被 abort 的 fetch 会让 `await` 抛 `AbortError`（`err.name === 'AbortError'`）。

简单做法：

```js
catch (err) {
  if (err.name === 'AbortError') {
    onCancel();   // 用户取消
  } else {
    onError(err); // 网络错
  }
}
```

**听起来够用，实际有坑**：

如果 SDK 内部有个 30 秒超时逻辑，到时间了**自己调** `abort()`——也会触发 `AbortError`。这时候 `err.name === 'AbortError'` 会被误判成「用户取消」，但实际是超时（应该报错）。

> **`AbortController` 是个沉默的执行者——它只负责中断，不告诉你原因。**

### 取消上下文（cancellation context）

SDK 内部维护一个标志位，**在 abort 之前记下原因**，事后还原：

```js
class AIChatSDK {
  async chat(prompt) {
    const controller = new AbortController();
    this.currentController = controller;
    this.cancelReason = null;   // ← 标志位
    
    const timeoutId = setTimeout(() => {
      this.cancelReason = 'timeout';
      controller.abort();
    }, 30_000);
    
    try {
      // ... fetch + 解析流
    } catch (err) {
      if (err.name === 'AbortError') {
        if (this.cancelReason === 'timeout') onError({ type: 'timeout' });
        else if (this.cancelReason === 'user') onCancel();
        else onCancel();   // 兜底
      } else {
        onError({ type: 'network', error: err });
      }
    }
  }
  
  stop() {
    this.cancelReason = 'user';
    this.currentController?.abort();
  }
}
```

Node 18+ 和现代浏览器原生支持了 `AbortSignal.reason`：

```js
controller.abort('user cancelled');
// catch 里：signal.reason === 'user cancelled'
```

但考虑兼容性和自定义业务原因，外部标志位仍然是更稳的写法。

## 十、组装完整 SDK

把前面所有零件拼起来：

```js
class MiniAISDK {
  constructor(config) {
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.model = config.model;
  }
  
  async chat(messages, callbacks) {
    const { onToken, onFinish, onError, onCancel } = callbacks;
    
    const controller = new AbortController();
    this.currentController = controller;
    this.cancelReason = null;
    
    let fullText = '';
    let receivedDone = false;
    
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
        }),
        signal: controller.signal,
      });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
      const processBlock = (block) => {
        const event = this._parseEventBlock(block);
        if (!event.data) return;
        
        if (event.data === '[DONE]') {
          receivedDone = true;
          return;
        }
        
        try {
          const json = JSON.parse(event.data);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            onToken?.(delta, fullText);
          }
        } catch {
          // 损坏的 JSON 跳过，不让单条坏消息毁掉整个流
        }
      };
      
      while (true) {
        const { value, done } = await reader.read();
        
        if (done) {
          // 流结束前 flush 解码器与 buffer 尾部——服务器未必在 [DONE] 后跟 \n\n
          buffer += decoder.decode();
          if (buffer.trim()) processBlock(buffer);
          buffer = '';
          if (!receivedDone) {
            throw new Error('Stream ended unexpectedly');
          }
          break;
        }
        
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop();
        
        for (const block of blocks) {
          processBlock(block);
        }
      }
      
      onFinish?.({ reason: 'stop', fullText });
      
    } catch (err) {
      if (err.name === 'AbortError') {
        if (this.cancelReason === 'user') {
          onCancel?.({ partialText: fullText });
        } else {
          onError?.({ type: 'unknown_abort', partialText: fullText, error: err });
        }
      } else {
        onError?.({ type: 'network', partialText: fullText, error: err });
      }
    } finally {
      this.currentController = null;
    }
  }
  
  stop() {
    this.cancelReason = 'user';
    this.currentController?.abort();
  }
  
  _parseEventBlock(block) {
    const event = {};
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const field = line.slice(0, idx);
      let value = line.slice(idx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      event[field] = value;
    }
    return event;
  }
}
```

## 十一、改造成 CLI 多轮对话

光有 SDK 还不够，搞个能交互的 demo 才好玩。用 Node 的 `readline` 模块：

```js
import readline from 'node:readline/promises';

const sdk = new MiniAISDK({
  endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  apiKey: '你的key',
  model: 'glm-4-flash',
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const messages = [
  { role: 'system', content: '你是一个简洁的助手，回答控制在 100 字以内。' },
];

async function main() {
  console.log('💬 开始对话（输入 exit 退出）\n');
  
  while (true) {
    const userInput = await rl.question('🧑 你: ');
    
    if (userInput.trim() === 'exit') {
      console.log('👋 再见');
      rl.close();
      break;
    }
    
    if (!userInput.trim()) continue;
    
    messages.push({ role: 'user', content: userInput });
    process.stdout.write('🤖 AI: ');
    
    await new Promise((resolve) => {
      sdk.chat(messages, {
        onToken: (delta) => process.stdout.write(delta),
        onFinish: ({ fullText }) => {
          process.stdout.write('\n\n');
          messages.push({ role: 'assistant', content: fullText });
          resolve();
        },
        onError: ({ type, error }) => {
          console.error(`\n❌ 错误（${type}）:`, error.message);
          messages.pop();  // 撤回未完成的用户消息
          resolve();
        },
        onCancel: () => {
          console.log('\n🛑 已取消');
          messages.pop();
          resolve();
        },
      });
    });
  }
}

main();
```

### 几个隐藏知识点

**① `readline` 本质上也是流式编程**

用户敲键盘是一个一个字符进来的，`readline` 内部维护 buffer，遇到 `\n` 才吐出一行。**和我们手写的 SSE 解析器一模一样的思路**——只是工作对象从「网络字节流」变成了「键盘输入流」。

**② `new Promise` 包装 callback**

`sdk.chat` 是 callback 风格的，立刻返回。如果直接 `while` 下一轮，光标会和 AI 输出抢屏。用 `new Promise` 包一层，在 `onFinish/onError/onCancel` 里 `resolve()`，外层 `await` 就能等到「AI 说完」这个时刻。

**这是 callback → Promise 的经典适配模式**。后续可以考虑直接对外暴露 async iterator，更优雅。

**③ 错误时 `messages.pop()` 的不变量保证**

OpenAI 协议要求 messages 严格 `user → assistant → user → assistant` 交替。如果一轮失败了不撤回，messages 就变成 `[..., user, user]`——下一轮 AI 会很懵，有些模型直接报错。

**维护对话历史的不变量（invariant），异常时回滚未完成轮次**——这又是一条值钱的设计原则。

---

## 总结：这个项目教会我的事

回头看，**我学到的远不止「怎么对接 AI 接口」**。这个项目本质上是一次「**异步编程和流式抽象**」的全面训练：

1. **`await` 的本质是「主动让出」**——不是「等待」，是「先把自己挂起来，让事件循环干别的」。
2. **chunk 边界 ≠ 消息边界**——这是所有流式协议的根本痛点，buffer + pop 是通用解。
3. **异步是事情本身的属性**，不是函数签名的选择。
4. **抽象的价值是把多层信号收敛成语义事件**——传输层、业务层、用户行为合起来才是「对话状态」。
5. **取消机制要带「原因上下文」**，不能只靠 `AbortError` 一个信号区分多种取消场景。
6. **协议标准化是 SDK 的杠杆**——OpenAI 协议成为事实标准后，一份代码连一片生态。

### 可以放到简历上的 bullet（示例）

- 从零封装基于 SSE 的 AI 流式对话 SDK，支持 OpenAI 兼容协议（覆盖智谱、通义、Kimi、DeepSeek 等 5+ provider）
- 设计基于 async generator 的流式解析层，正确处理 chunk 边界、UTF-8 多字节切分、损坏消息容错
- 识别 AbortError 的语义二义性，通过 cancellation context 区分用户取消 / 超时 / 网络异常 / 主动重试四种中断场景
- 基于双层结束信号（HTTP 传输层 `done` + 业务层 `[DONE]`）设计可靠的对话终止判定
- 维护多轮对话历史不变量（user/assistant 严格交替），异常时自动回滚未完成轮次

### 下一步还能做什么

这个 SDK 现在还很小，往深里挖还有：

- **流式 Markdown 渲染**（解决代码块流到一半的渲染崩溃）
- **消息树而非数组**（支持「编辑用户消息后重新生成」的分叉）
- **工具调用（Function Calling）流式组装**（JSON 参数也是 token 流，得拼齐再解析）
- **打字机平滑播放**（网络脉冲式到达，UI 要丝滑）
- **Token 计数与上下文裁剪**（消息越来越多怎么办）
- **多 provider 适配层**（统一 OpenAI / Anthropic / Gemini 三种事件格式）

每一个都是一段独立的故事，下次再写。

---

> 最大的收获不是写出了什么代码，而是搞懂了**异步和流式到底是什么**。这种底层认知，比任何框架技巧都更耐用。
